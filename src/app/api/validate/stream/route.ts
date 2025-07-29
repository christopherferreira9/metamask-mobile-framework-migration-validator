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

// Fixture-related imports that must come from /framework
const FIXTURE_IMPORTS = [
  'FixtureBuilder',
  'FixtureHelper',
  'FixtureUtils'
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
  
  // Only run checks on files under the e2e/ directory
  const isE2eFile = file.filename.startsWith('e2e/');
  
  // If not an e2e file, return empty issues array
  if (!isE2eFile) {
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
    
    // Check for withFixtures import without /framework/fixtures in the path
    if (cleanLine.includes('import') && cleanLine.includes('withFixtures') && !cleanLine.includes('/framework/fixtures')) {
      issues.push({
        file: file.filename,
        line: getOriginalLineNumber(lines, index),
        importStatement: cleanLine,
        checkType: 'fixtures-framework'
      });
    }
    
    // Check for Matchers import without /framework in the path
    if (cleanLine.includes('import') && cleanLine.includes('Matchers') && !cleanLine.includes('/framework')) {
      issues.push({
        file: file.filename,
        line: getOriginalLineNumber(lines, index),
        importStatement: cleanLine,
        checkType: 'matchers-framework'
      });
    }
    
    // Check for fixture-related imports without /framework in the path
    for (const fixtureImport of FIXTURE_IMPORTS) {
      if (cleanLine.includes('import') && cleanLine.includes(fixtureImport) && !cleanLine.includes('/framework')) {
        // For multiline imports, we need to check if this is part of a multiline import statement
        // that might have the framework path in another line
        let isMultilineImport = false;
        let hasFrameworkPath = false;
        
        // Check if this line is the start of a multiline import (has opening brace but no closing brace)
        if (cleanLine.includes('{') && !cleanLine.includes('}')) {
          isMultilineImport = true;
          
          // Look ahead for the closing brace and check if any line contains '/framework'
          let j = index;
          while (j < addedLines.length) {
            const nextLine = addedLines[j].substring(1).trim();
            if (nextLine.includes('/framework')) {
              hasFrameworkPath = true;
              break;
            }
            if (nextLine.includes('}')) {
              break;
            }
            j++;
          }
        }
        
        // Look behind for the import statement if this line contains the closing brace
        if (cleanLine.includes('}') && !cleanLine.includes('import')) {
          isMultilineImport = true;
          
          // Look behind for the import statement
          let j = index;
          while (j >= 0) {
            const prevLine = addedLines[j].substring(1).trim();
            if (prevLine.includes('import') && prevLine.includes('/framework')) {
              hasFrameworkPath = true;
              break;
            }
            if (prevLine.includes('import')) {
              break;
            }
            j--;
          }
        }
        
        // Only add an issue if it's not part of a multiline import with framework path
        if (!isMultilineImport || (isMultilineImport && !hasFrameworkPath)) {
          issues.push({
            file: file.filename,
            line: getOriginalLineNumber(lines, index),
            importStatement: cleanLine,
            checkType: 'fixture-utils-framework'
          });
          break; // Only add one issue per line even if multiple fixture imports are found
        }
      }
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
  
  // Check for test files that need withFixtures in each it() block
  if (file.filename.endsWith('.spec.ts')) {
    validateTestFile(file, lines, issues);
  }
  
  return issues;
}

/**
 * Validate test files to ensure each it() block has a withFixtures reference
 * @param file The file object
 * @param lines The lines from the patch
 * @param issues The issues array to add to
 */
function validateTestFile(file: any, lines: string[], issues: any[]): void {
  // Get all added lines that contain 'it(' or 'it.only(' or similar test declarations
  const testBlockLines = lines.filter(line => 
    line.startsWith('+') && 
    !line.startsWith('+++') && 
    /\bit(\.|)(\w+|)\s*\(/.test(line.substring(1).trim())
  );
  
  // For each test block, check if it has a withFixtures reference within a reasonable range
  testBlockLines.forEach(testLine => {
    const lineIndex = lines.indexOf(testLine);
    const testLineClean = testLine.substring(1).trim();
    
    // Check if withFixtures is already in the test line itself
    if (testLineClean.includes('withFixtures')) {
      return; // withFixtures is already in the test declaration line
    }
    
    // Find the closing parenthesis or the end of the block
    let foundWithFixtures = false;
    let blockEndFound = false;
    let currentLine = lineIndex;
    let blockDepth = 0;
    let parenDepth = 0;
    
    // Count opening parentheses and braces in the test line itself
    for (const char of testLineClean) {
      if (char === '(') parenDepth++;
      if (char === ')') parenDepth--;
      if (char === '{') blockDepth++;
      if (char === '}') blockDepth--;
    }
    
    // If the test declaration spans multiple lines, we need to find where it ends
    if (parenDepth > 0) {
      // Look for the closing parenthesis of the test declaration
      let declarationEndFound = false;
      let tempLine = lineIndex;
      
      while (tempLine < lines.length - 1 && !declarationEndFound && parenDepth > 0) {
        tempLine++;
        const nextLine = lines[tempLine];
        
        // Skip lines that aren't added in the PR
        if (!nextLine.startsWith('+') && !nextLine.startsWith('-')) continue;
        
        const cleanNextLine = nextLine.startsWith('+') ? nextLine.substring(1).trim() : nextLine.substring(1).trim();
        
        // Check for withFixtures in the test declaration
        if (cleanNextLine.includes('withFixtures')) {
          foundWithFixtures = true;
          break;
        }
        
        // Track parenthesis depth
        for (const char of cleanNextLine) {
          if (char === '(') parenDepth++;
          if (char === ')') {
            parenDepth--;
            if (parenDepth === 0) {
              declarationEndFound = true;
              break;
            }
          }
        }
      }
    }
    
    // If we already found withFixtures in the declaration, no need to check the block
    if (foundWithFixtures) {
      return;
    }
    
    // Look ahead for withFixtures until we find the end of the block
    while (currentLine < lines.length - 1 && !blockEndFound && blockDepth >= 0) {
      currentLine++;
      const nextLine = lines[currentLine];
      
      // Consider both added and context lines (not removed lines)
      if (nextLine.startsWith('-')) continue;
      
      // For added lines, remove the '+' prefix
      const cleanNextLine = nextLine.startsWith('+') ? nextLine.substring(1).trim() : nextLine.trim();
      
      // Check for withFixtures reference - be more specific about the pattern
      // Look for withFixtures followed by opening parenthesis or dot
      if (
        cleanNextLine.includes('withFixtures(') || 
        cleanNextLine.includes('withFixtures.') ||
        cleanNextLine.includes('withFixtures (') ||
        /\bwithFixtures\s*\(/.test(cleanNextLine)
      ) {
        foundWithFixtures = true;
        break;
      }
      
      // Track block depth
      for (const char of cleanNextLine) {
        if (char === '{') blockDepth++;
        if (char === '}') {
          blockDepth--;
          // If we've closed the initial block, we're done
          if (blockDepth < 0) {
            blockEndFound = true;
            break;
          }
        }
      }
    }
    
    // If we didn't find withFixtures in the test block, report an issue
    if (!foundWithFixtures) {
      // Calculate the actual line number in the file
      // First find the hunk header that precedes this line
      let hunkHeaderIndex = lineIndex;
      while (hunkHeaderIndex >= 0) {
        if (lines[hunkHeaderIndex].startsWith('@@')) {
          break;
        }
        hunkHeaderIndex--;
      }
      
      let lineNumber: number | string = 'N/A';
      
      if (hunkHeaderIndex >= 0) {
        // Parse the hunk header to get the starting line number
        const hunkHeader = lines[hunkHeaderIndex];
        const match = hunkHeader.match(/@@ -\d+,\d+ \+(\d+),\d+ @@/);
        if (match) {
          const hunkStartLine = parseInt(match[1], 10);
          
          // Count lines from hunk start to our test line
          let linesAfterHunk = 0;
          for (let i = hunkHeaderIndex + 1; i < lineIndex; i++) {
            if (!lines[i].startsWith('-')) {
              linesAfterHunk++;
            }
          }
          
          lineNumber = hunkStartLine + linesAfterHunk - 1;
        }
      }
      
      issues.push({
        file: file.filename,
        line: lineNumber,
        importStatement: testLineClean,
        checkType: 'test-withfixtures'
      });
    }
  });
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