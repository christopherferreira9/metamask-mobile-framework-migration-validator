import { parseGitHubPrUrl } from '@/utils/prValidator';
import { NextRequest } from 'next/server';
import { Octokit } from 'octokit';

// Initialize Octokit with auth token if available
const octokit = new Octokit(
  process.env.GITHUB_TOKEN 
    ? { auth: process.env.GITHUB_TOKEN }
    : {}
);

// Log token status for debugging
console.log('GitHub token available:', Boolean(process.env.GITHUB_TOKEN));

// Valid types that should precede getter methods
const VALID_GETTER_TYPES = [
  'DetoxElement', 
  'TappableElement', 
  'TypableElement', 
  'WebElement', 
  'IndexableNativeElement', 
  'NativeElement', 
  'SystemElement', 
  'DeviceLaunchAppConfig', 
  'DetoxMatcher'
];

/**
 * Check if a type is valid, either directly or as Promise<ValidType>
 * @param typeName The type name to check
 * @returns boolean indicating if the type is valid
 */
const isValidGetterType = (typeName: string): boolean => {
  // Check for direct match
  if (VALID_GETTER_TYPES.includes(typeName)) {
    return true;
  }
  
  // Check for Promise<ValidType>
  const promiseRegex = /^Promise<([A-Za-z0-9_]+)>$/;
  const match = typeName.match(promiseRegex);
  if (match && VALID_GETTER_TYPES.includes(match[1])) {
    return true;
  }
  
  return false;
};

export async function POST(request: NextRequest) {
  const encoder = new TextEncoder();

  try {
    console.log('Stream validation API called');
    const body = await request.json();
    const { prLink } = body;
    
    console.log('PR Link received:', prLink);
    
    if (!prLink) {
      console.log('No PR link provided');
      return new Response(
        encoder.encode(JSON.stringify({ error: 'PR link is required' })),
        { status: 400 }
      );
    }

    // Create a TransformStream for streaming the response
    const stream = new TransformStream();
    const writer = stream.writable.getWriter();

    // Start processing in the background
    processPrValidation(prLink, writer).catch(error => {
      console.error('Error in streaming validation:', error);
      writer.write(encoder.encode(JSON.stringify({ 
        type: 'error', 
        message: error.message || 'An error occurred during validation' 
      }) + '\n'));
      writer.close();
    });

    console.log('Returning stream response');
    // Return the readable stream to the client
    return new Response(stream.readable, {
      headers: {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
      },
    });
    
  } catch (error: any) {
    console.error('Error in stream validation API:', error);
    return new Response(
      encoder.encode(JSON.stringify({ 
        error: error.message || 'An error occurred during validation' 
      })),
      { status: 500 }
    );
  }
}

async function processPrValidation(prLink: string, writer: WritableStreamDefaultWriter) {
  const encoder = new TextEncoder();
  
  try {
    console.log('Starting PR validation process');
    
    // Parse GitHub PR URL
    const { owner, repo, pullNumber } = parseGitHubPrUrl(prLink);
    console.log('Parsed PR info:', { owner, repo, pullNumber });
    
    // Send init message
    writer.write(encoder.encode(JSON.stringify({ 
      type: 'init', 
      message: 'Starting PR validation...' 
    }) + '\n'));
    
    console.log('Fetching PR data from GitHub API');
    // Get the PR data
    const { data: pullRequest } = await octokit.rest.pulls.get({
      owner,
      repo,
      pull_number: pullNumber
    });
    
    console.log('PR data fetched successfully');
    // Send PR info
    writer.write(encoder.encode(JSON.stringify({ 
      type: 'pr_info',
      data: {
        title: pullRequest.title,
        url: pullRequest.html_url,
        author: pullRequest.user.login
      }
    }) + '\n'));
    
    // Get the files in the PR
    const { data: files } = await octokit.rest.pulls.listFiles({
      owner,
      repo,
      pull_number: pullNumber
    });
    
    // Send total files info
    writer.write(encoder.encode(JSON.stringify({ 
      type: 'total_files',
      count: files.length
    }) + '\n'));
    
    const allIssues: any[] = [];
    const checkedFiles: string[] = [];
    
    // Process each file
    for (const file of files) {
      // Add to checked files
      checkedFiles.push(file.filename);
      
      // Send file checked event
      writer.write(encoder.encode(JSON.stringify({ 
        type: 'file_checked',
        file: file.filename
      }) + '\n'));
      
      // Check for issues
      const fileIssues = validateFileContent(file);
      if (fileIssues.length > 0) {
        allIssues.push(...fileIssues);
        
        // Send issue found event
        writer.write(encoder.encode(JSON.stringify({ 
          type: 'issue_found',
          issues: fileIssues
        }) + '\n'));
      }
      
      // Add a small delay to make the streaming more visible (remove in production)
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    
    // Send completion event
    writer.write(encoder.encode(JSON.stringify({ 
      type: 'complete',
      data: {
        pr: {
          title: pullRequest.title,
          url: pullRequest.html_url,
          author: pullRequest.user.login
        },
        issues: allIssues,
        filesChecked: files.length,
        checkedFiles: checkedFiles
      }
    }) + '\n'));
    
    // Close the writer
    writer.close();
    
  } catch (error: any) {
    console.error('Error processing PR validation:', error);
    writer.write(encoder.encode(JSON.stringify({ 
      type: 'error', 
      message: error.message || 'An error occurred during validation' 
    }) + '\n'));
    writer.close();
  }
}

function validateFileContent(file: any) {
  const issues: any[] = [];
  
  // Only process files with content (skip binary files or removed files)
  if (!file.patch) {
    return issues;
  }
  
  const lines = file.patch.split('\n');
  const addedLines = lines.filter((line: string) => line.startsWith('+') && !line.startsWith('+++'));
  
  // Process each added line
  addedLines.forEach((line: string, index: number) => {
    // Clean the line from the '+' prefix for comparison
    const cleanLine = line.substring(1).trim();
    
    // Check for Assertions import without /framework in the path
    if (cleanLine.includes('import') && cleanLine.includes('Assertions') && !cleanLine.includes('/framework')) {
      issues.push({
        file: file.filename,
        line: getOriginalLineNumber(lines, index),
        importStatement: cleanLine,
        checkType: 'assertions-framework'
      });
    }
    
    // Check for Assertions import with .ts extension
    if (cleanLine.includes('import') && cleanLine.includes('Assertions') && cleanLine.includes('.ts')) {
      issues.push({
        file: file.filename,
        line: getOriginalLineNumber(lines, index),
        importStatement: cleanLine,
        checkType: 'assertions-no-ts'
      });
    }
    
    // Check for gestures import without /framework in the path
    if (cleanLine.includes('import') && cleanLine.includes('gestures') && !cleanLine.includes('/framework')) {
      issues.push({
        file: file.filename,
        line: getOriginalLineNumber(lines, index),
        importStatement: cleanLine,
        checkType: 'gestures-framework'
      });
    }
    
    // Check for getter methods without proper type prefixes
    // Looking for patterns like "get something()" but not when followed by a valid return type
    const getterMethodRegex = /\bget\s+\w+\s*\(/;
    if (getterMethodRegex.test(cleanLine)) {
      // Check if getter is properly typed in TypeScript (get x(): Type or Promise<Type>)
      const tsGetterRegex = /\bget\s+\w+\s*\(\s*\)\s*:\s*([A-Za-z0-9_<>]+)/;
      const tsMatch = cleanLine.match(tsGetterRegex);
      
      if (tsMatch) {
        // If we have a TypeScript type annotation, check if it's one of the valid types
        // or Promise<ValidType>
        const returnType = tsMatch[1];
        if (isValidGetterType(returnType)) {
          // This is correctly typed, so don't flag it
          return;
        }
      }
      
      // Check if any of the valid types precede the getter (for non-TypeScript cases)
      const hasValidType = VALID_GETTER_TYPES.some(type => 
        cleanLine.includes(`${type}.prototype.get`) || 
        cleanLine.includes(`${type}['prototype']['get`) ||
        cleanLine.includes(`${type}.get`) ||
        cleanLine.includes(`${type}['get`) ||
        cleanLine.includes(`${type}["get`)
      );
      
      if (!hasValidType) {
        issues.push({
          file: file.filename,
          line: getOriginalLineNumber(lines, index),
          importStatement: cleanLine,
          checkType: 'getter-type'
        });
      }
    }
  });
  
  return issues;
}

function getOriginalLineNumber(lines: string[], addedLineIndex: number) {
  let originalLineIndex = 0;
  let addedLineCount = 0;
  
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].startsWith('+') && !lines[i].startsWith('+++')) {
      if (addedLineCount === addedLineIndex) {
        return originalLineIndex;
      }
      addedLineCount++;
    }
    if (!lines[i].startsWith('-') && !lines[i].startsWith('---')) {
      originalLineIndex++;
    }
  }
  
  return 'N/A';
} 