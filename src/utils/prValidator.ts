import { Octokit } from 'octokit';

// Initialize Octokit with auth token if available
const octokit = new Octokit(
  process.env.GITHUB_TOKEN 
    ? { auth: process.env.GITHUB_TOKEN }
    : {}
);

interface PrInfo {
  owner: string;
  repo: string;
  pullNumber: number;
}

interface Issue {
  file: string;
  line: number | string;
  importStatement: string;
  checkType: 'assertions-framework' | 'assertions-no-ts' | 'gestures-framework' | 'getter-type';
}

interface ValidationResult {
  pr: {
    title: string;
    url: string;
    author: string;
  };
  issues: Issue[];
  filesChecked: number;
  checkedFiles: string[];
}

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
 * Parse GitHub PR URL to extract owner, repo and PR number
 * @param prUrl The GitHub PR URL
 * @returns Object containing owner, repo and PR number
 */
export const parseGitHubPrUrl = (prUrl: string): PrInfo => {
  const regex = /https:\/\/github\.com\/([^\/]+)\/([^\/]+)\/pull\/(\d+)/;
  const match = prUrl.match(regex);
  
  if (!match) {
    throw new Error('Invalid GitHub PR URL');
  }
  
  return {
    owner: match[1],
    repo: match[2],
    pullNumber: parseInt(match[3])
  };
};

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

/**
 * Check various import and code patterns
 * @param file The file content
 * @returns Array of issues found or empty if no issues
 */
const validateFileContent = (file: any): Issue[] => {
  const issues: Issue[] = [];
  
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
};

/**
 * Get the original line number from the diff
 * @param lines All lines in the diff
 * @param addedLineIndex Index of the added line in the filtered array
 * @returns The original line number or 'N/A' if can't determine
 */
const getOriginalLineNumber = (lines: string[], addedLineIndex: number): number | string => {
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
};

/**
 * Get and analyze the diff of a GitHub PR
 * @param prLink The GitHub PR URL
 * @returns Validation results
 */
export const validatePr = async (prLink: string): Promise<ValidationResult> => {
  try {
    const { owner, repo, pullNumber } = parseGitHubPrUrl(prLink);
    
    // Get the PR data
    const { data: pullRequest } = await octokit.rest.pulls.get({
      owner,
      repo,
      pull_number: pullNumber
    });
    
    // Get the files in the PR
    const { data: files } = await octokit.rest.pulls.listFiles({
      owner,
      repo,
      pull_number: pullNumber
    });
    
    const allIssues: Issue[] = [];
    const checkedFiles: string[] = []; // Array to store all filenames
    
    // Check each file for Assertions imports
    for (const file of files) {
      // Add filename to the list of checked files
      checkedFiles.push(file.filename);
      
      const fileIssues = validateFileContent(file);
      allIssues.push(...fileIssues);
    }
    
    return {
      pr: {
        title: pullRequest.title,
        url: pullRequest.html_url,
        author: pullRequest.user.login
      },
      issues: allIssues,
      filesChecked: files.length,
      checkedFiles // Include the list of all checked files
    };
    
  } catch (error: any) {
    console.error('Error validating PR:', error);
    throw new Error(`Failed to validate PR: ${error.message}`);
  }
}; 