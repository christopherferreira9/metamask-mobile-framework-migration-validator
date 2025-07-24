'use client';

import { useState, useEffect, useRef } from 'react';

interface Issue {
  file: string;
  line: number | string;
  importStatement: string;
  checkType: 'assertions-framework' | 'assertions-no-ts' | 'gestures-framework' | 'getter-type' | 'fixtures-framework' | 'test-withfixtures' | 'matchers-framework';
}

interface PrInfo {
  title: string;
  url: string;
  author: string;
}

interface ValidationResult {
  pr: PrInfo;
  issues: Issue[];
  filesChecked: number;
  checkedFiles: string[];
}

interface FileCheckState {
  [filename: string]: boolean; // track expanded/collapsed state for each file
}

// Description mapping for each check type
const CHECK_DESCRIPTIONS = {
  'assertions-framework': 'Assertions import must include /framework path',
  'assertions-no-ts': 'Assertions import should not include .ts extension',
  'gestures-framework': 'Gestures import must include /framework path',
  'getter-type': 'Getter methods must have proper type prefix',
  'fixtures-framework': 'withFixtures import must include /framework/fixtures path',
  'test-withfixtures': 'Test files must use withFixtures in each it() block',
  'matchers-framework': 'Matchers import must include /framework path'
};

// Get the base URL depending on environment
const getApiUrl = (path: string) => {
  // No need for basePath with Vercel deployment
  return path;
};

const PRValidator: React.FC = () => {
  const [prLink, setPrLink] = useState<string>('');
  const [results, setResults] = useState<ValidationResult | null>(null);
  const [loading, setLoading] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);
  const [copiedFile, setCopiedFile] = useState<string | null>(null);
  
  // Live updating state - always enabled
  const [totalFiles, setTotalFiles] = useState<number>(0);
  const [processedFiles, setProcessedFiles] = useState<string[]>([]);
  const [foundIssues, setFoundIssues] = useState<Issue[]>([]);
  const [prInfo, setPrInfo] = useState<PrInfo | null>(null);
  const [processingComplete, setProcessingComplete] = useState<boolean>(false);
  
  // Track expanded/collapsed state of each file
  const [expandedFiles, setExpandedFiles] = useState<FileCheckState>({});
  
  // For abort controller
  const abortControllerRef = useRef<AbortController | null>(null);

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setPrLink(e.target.value);
  };

  // Toggle expanded/collapsed state of a file
  const toggleFileExpanded = (filename: string) => {
    setExpandedFiles(prev => ({
      ...prev,
      [filename]: !prev[filename]
    }));
  };

  // Create a GitHub diff link for a specific file
  const getFileDiffLink = (file: string): string => {
    // Remove trailing slash from PR link if it exists
    const cleanPrLink = prInfo?.url?.endsWith('/') ? prInfo.url.slice(0, -1) : prInfo?.url || '';
    
    // Just navigate to the Files tab - GitHub's deep linking to specific files is inconsistent
    // Users can use GitHub's file filter once on the page
    return `${cleanPrLink}/files`;
  };
  
  // Copy filename to clipboard
  const copyFilename = (filename: string, e: React.MouseEvent) => {
    e.stopPropagation();
    navigator.clipboard.writeText(filename)
      .then(() => {
        setCopiedFile(filename);
        setTimeout(() => setCopiedFile(null), 2000);
      })
      .catch(err => console.error('Failed to copy filename: ', err));
  };

  // Clean up function for when validation ends
  const resetLiveState = () => {
    setTotalFiles(0);
    setProcessedFiles([]);
    setFoundIssues([]);
    setPrInfo(null);
    setProcessingComplete(false);
    setExpandedFiles({});
    
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
      abortControllerRef.current = null;
    }
  };

  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    
    // Validate input is a GitHub PR link - allow optional trailing slash
    const prLinkRegex = /^https:\/\/github\.com\/[\w-]+\/[\w-]+\/pull\/\d+\/?$/;
    if (!prLinkRegex.test(prLink)) {
      setError('Please enter a valid GitHub PR link (e.g., https://github.com/owner/repo/pull/123)');
      return;
    }
    
    setLoading(true);
    setError(null);
    setResults(null);
    resetLiveState();
    
    try {
      await handleStreamValidation();
    } catch (err: any) {
      setError(err.message || 'An error occurred while validating the PR');
      setLoading(false);
    }
  };

  const handleStreamValidation = async () => {
    abortControllerRef.current = new AbortController();
    
    try {
      const response = await fetch(getApiUrl('/api/validate/stream'), {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ prLink }),
        signal: abortControllerRef.current.signal
      });
      
      if (!response.ok || !response.body) {
        throw new Error('Failed to start streaming validation');
      }
      
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      
      let buffer = '';
      
      while (true) {
        const { value, done } = await reader.read();
        
        if (done) {
          break;
        }
        
        buffer += decoder.decode(value, { stream: true });
        
        // Process complete events
        const lines = buffer.split('\n');
        buffer = lines.pop() || ''; // Keep the last incomplete line in the buffer
        
        for (const line of lines) {
          if (line.trim() === '') continue;
          
          try {
            const event = JSON.parse(line);
            processStreamEvent(event);
          } catch (e) {
            console.error('Error parsing event:', e, line);
          }
        }
      }
      
      // Process any remaining buffer
      if (buffer.trim()) {
        try {
          const event = JSON.parse(buffer);
          processStreamEvent(event);
        } catch (e) {
          console.error('Error parsing final event:', e, buffer);
        }
      }
      
    } catch (err: any) {
      if (err.name !== 'AbortError') {
        setError(err.message || 'Error in streaming validation');
      }
    } finally {
      setLoading(false);
    }
  };

  const processStreamEvent = (event: any) => {
    switch (event.type) {
      case 'init':
        // Just log or update UI with starting message
        break;
        
      case 'pr_info':
        setPrInfo(event.data);
        break;
        
      case 'total_files':
        setTotalFiles(event.count);
        break;
        
      case 'file_checked':
        setProcessedFiles(prev => [...prev, event.file]);
        break;
        
      case 'issue_found':
        setFoundIssues(prev => [...prev, ...event.issues]);
        break;
        
      case 'complete':
        setResults(event.data);
        setProcessingComplete(true);
        setLoading(false);
        break;
        
      case 'error':
        setError(event.message);
        setLoading(false);
        break;
        
      default:
        console.log('Unknown event type:', event);
    }
  };

  // Helper function to determine if a file has issues
  const fileHasIssues = (filename: string) => {
    if (loading) {
      return foundIssues.some(issue => issue.file === filename);
    }
    
    if (results) {
      return results.issues.some(issue => issue.file === filename);
    }
    
    return false;
  };
  
  // Get issues for a specific file
  const getIssuesForFile = (filename: string) => {
    if (loading) {
      return foundIssues.filter(issue => issue.file === filename);
    }
    
    if (results) {
      return results.issues.filter(issue => issue.file === filename);
    }
    
    return [];
  };
  
  // Get issues for a specific check type in a file
  const getIssuesByCheckType = (filename: string, checkType: string) => {
    const fileIssues = getIssuesForFile(filename);
    return fileIssues.filter(issue => issue.checkType === checkType);
  };

  // Check if a specific file has issues for a particular check type
  const hasIssuesForCheckType = (filename: string, checkType: string) => {
    const fileIssues = getIssuesForFile(filename);
    return fileIssues.some(issue => issue.checkType === checkType);
  };
  
  // Calculate progress percentage for live mode
  const calculateProgress = () => {
    if (totalFiles === 0) return 0;
    return Math.round((processedFiles.length / totalFiles) * 100);
  };

  // Get current files to display (either from live updates or final results)
  const getFilesToDisplay = () => {
    if (loading) {
      return processedFiles;
    }
    
    if (results) {
      return results.checkedFiles;
    }
    
    return [];
  };
  
  // Get current issues to display (either from live updates or final results)
  const getIssuesToDisplay = () => {
    if (loading) {
      return foundIssues;
    }
    
    if (results) {
      return results.issues;
    }
    
    return [];
  };

  return (
    <div className="max-w-5xl mx-auto w-full px-4 py-6">
      <h1 className="text-3xl font-bold mb-4 text-center">🦊 PR Migration Validator</h1>
      <p className="text-center mb-6">Enter a GitHub PR link to validate the framework migration</p>
      
      <form onSubmit={handleSubmit} className="mb-8">
        <div className="flex flex-col sm:flex-row gap-4">
          <input
            type="text"
            value={prLink}
            onChange={handleInputChange}
            placeholder="https://github.com/owner/repo/pull/123"
            className="flex-1 px-4 py-2 border rounded focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
          <button 
            type="submit" 
            disabled={loading}
            className="bg-blue-600 text-white px-6 py-2 rounded hover:bg-blue-700 disabled:bg-blue-400 disabled:cursor-not-allowed"
          >
            {loading ? 'Validating...' : 'Validate'}
          </button>
        </div>
      </form>
      
      {error && (
        <div className="bg-red-100 border border-red-400 text-red-700 px-4 py-3 rounded mb-6" role="alert">
          <p>{error}</p>
        </div>
      )}
      
      {loading && (
        <div className="border rounded-lg p-6 bg-gray-50 mb-6">
          <div className="mb-4">
            <h2 className="text-xl font-semibold mb-2">Validating PR in real time...</h2>
            
            {prInfo && (
              <div className="mb-4">
                <p className="font-medium">
                  <a href={prInfo.url} target="_blank" rel="noopener noreferrer" className="text-blue-600 hover:underline">
                    {prInfo.title}
                  </a>
                </p>
                <p>Author: <span className="font-medium">{prInfo.author}</span></p>
              </div>
            )}
            
            {totalFiles > 0 && (
              <div className="mb-4">
                <div className="flex justify-between mb-1">
                  <span>Progress: {processedFiles.length} / {totalFiles} files</span>
                  <span>{calculateProgress()}%</span>
                </div>
                <div className="w-full bg-gray-200 rounded-full h-2.5">
                  <div 
                    className="bg-blue-600 h-2.5 rounded-full" 
                    style={{ width: `${calculateProgress()}%` }}
                  ></div>
                </div>
              </div>
            )}
          </div>
        </div>
      )}
      
      {/* Always show results section if we have files */}
      {(results || processedFiles.length > 0) && (
        <div className="border rounded-lg p-6 bg-gray-50">
          <div className="space-y-6">
            {/* PR Information */}
            <div>
              <h2 className="text-2xl font-semibold mb-2">PR Information</h2>
              <div className="bg-white rounded p-4 border">
                {prInfo ? (
                  <>
                    <p className="font-medium text-lg">
                      <a href={prInfo.url} target="_blank" rel="noopener noreferrer" className="text-blue-600 hover:underline">
                        {prInfo.title}
                      </a>
                    </p>
                    <p>Author: <span className="font-medium">{prInfo.author}</span></p>
                  </>
                ) : (
                  <p>Loading PR information...</p>
                )}
                
                <p>Files checked: <span className="font-medium">{loading ? processedFiles.length : (results?.filesChecked || 0)}</span>
                  {loading && totalFiles > 0 && !processingComplete && ` / ${totalFiles}`}
                </p>
              </div>
            </div>
            
            {/* Validation Summary */}
            <div>
              <h2 className="text-2xl font-semibold mb-2">Validation Summary</h2>
              
              {getIssuesToDisplay().length === 0 ? (
                <div className="bg-green-100 border border-green-400 text-green-700 px-4 py-3 rounded mb-4">
                  <p className="font-medium">
                    {processingComplete || !loading ? 
                      "✅ All checks passed successfully!" :
                      "✅ No issues found so far..."
                    }
                  </p>
                </div>
              ) : (
                <div className="bg-amber-100 border border-amber-400 text-amber-700 px-4 py-3 rounded mb-4">
                  <p className="font-medium">⚠️ Found {getIssuesToDisplay().length} issue(s) across {new Set(getIssuesToDisplay().map(i => i.file)).size} file(s)</p>
                  
                  <div className="mt-3">
                    <p className="text-sm font-medium mb-2">Issues by check type:</p>
                    <ul className="list-disc pl-5 space-y-1">
                      {Object.entries(CHECK_DESCRIPTIONS).map(([checkType, description]) => {
                        const issuesCount = getIssuesToDisplay().filter(i => i.checkType === checkType).length;
                        if (issuesCount === 0) return null;
                        
                        return (
                          <li key={checkType}>
                            <span className="font-medium">{description}:</span> {issuesCount} issue(s)
                          </li>
                        );
                      })}
                    </ul>
                  </div>
                </div>
              )}
            </div>
            
            {/* All Checked Files */}
            <div>
              <h2 className="text-2xl font-semibold mb-2">Files</h2>
              <div className="border rounded bg-white p-4 overflow-y-auto max-h-96">
                <ul className="space-y-2">
                  {getFilesToDisplay().map((file, index) => {
                    const hasIssue = fileHasIssues(file);
                    const isExpanded = expandedFiles[file] || false;
                    const fileDiffLink = getFileDiffLink(file);
                    const isCopied = copiedFile === file;
                    
                    return (
                      <li 
                        key={index}
                        className={`border rounded ${hasIssue ? 'border-amber-300' : 'border-gray-200'}`}
                      >
                        <div 
                          className={`p-3 flex justify-between items-center ${hasIssue ? 'bg-amber-50' : ''}`}
                        >
                          <div className="flex items-center flex-grow cursor-pointer" onClick={() => toggleFileExpanded(file)}>
                            <span className={`mr-2 ${hasIssue ? 'text-amber-600' : 'text-green-600'}`}>
                              {hasIssue ? '⚠️' : '✓'}
                            </span>
                            <span className={`break-all ${hasIssue ? 'text-amber-800 font-medium' : ''}`}>{file}</span>
                          </div>
                          <div className="flex items-center ml-2">
                            {/* Copy Button */}
                            <button
                              type="button"
                              onClick={(e) => copyFilename(file, e)}
                              className="text-gray-500 hover:text-blue-600 mr-3 flex items-center"
                              title="Copy filename"
                            >
                              {isCopied ? (
                                <>
                                  <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4 mr-1" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                                  </svg>
                                  <span className="text-xs">Copied!</span>
                                </>
                              ) : (
                                <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
                                </svg>
                              )}
                            </button>
                            
                            {/* Expand/Collapse Icon */}
                            <span 
                              className="text-gray-500 cursor-pointer"
                              onClick={() => toggleFileExpanded(file)}
                            >
                              {isExpanded ? '▼' : '▶'}
                            </span>
                          </div>
                        </div>
                        
                        {isExpanded && (
                          <div className="border-t p-3 bg-gray-50">
                            <div className="mb-2 font-medium">Checks:</div>
                            <div className="pl-4 border-l-4 border-gray-300 space-y-4">
                              {/* Assertions framework path check */}
                              <div className="mb-2">
                                <div className="flex items-center">
                                  <span className={`mr-2 ${hasIssuesForCheckType(file, 'assertions-framework') ? 'text-amber-600' : 'text-green-600'}`}>
                                    {hasIssuesForCheckType(file, 'assertions-framework') ? '⚠️' : '✓'}
                                  </span>
                                  <span>{CHECK_DESCRIPTIONS['assertions-framework']}</span>
                                </div>
                                
                                {hasIssuesForCheckType(file, 'assertions-framework') && (
                                  <div className="mt-2 pl-6">
                                    <span className="text-sm font-medium">Found issues:</span>
                                    <ul className="list-disc pl-5 space-y-1 mt-1 text-sm">
                                      {getIssuesByCheckType(file, 'assertions-framework').map((issue, idx) => (
                                        <li key={idx}>
                                          Line {issue.line}: <code className="bg-amber-50 p-1 rounded">{issue.importStatement}</code>
                                        </li>
                                      ))}
                                    </ul>
                                  </div>
                                )}
                              </div>
                              
                              {/* Assertions no .ts extension check */}
                              <div className="mb-2">
                                <div className="flex items-center">
                                  <span className={`mr-2 ${hasIssuesForCheckType(file, 'assertions-no-ts') ? 'text-amber-600' : 'text-green-600'}`}>
                                    {hasIssuesForCheckType(file, 'assertions-no-ts') ? '⚠️' : '✓'}
                                  </span>
                                  <span>{CHECK_DESCRIPTIONS['assertions-no-ts']}</span>
                                </div>
                                
                                {hasIssuesForCheckType(file, 'assertions-no-ts') && (
                                  <div className="mt-2 pl-6">
                                    <span className="text-sm font-medium">Found issues:</span>
                                    <ul className="list-disc pl-5 space-y-1 mt-1 text-sm">
                                      {getIssuesByCheckType(file, 'assertions-no-ts').map((issue, idx) => (
                                        <li key={idx}>
                                          Line {issue.line}: <code className="bg-amber-50 p-1 rounded">{issue.importStatement}</code>
                                        </li>
                                      ))}
                                    </ul>
                                  </div>
                                )}
                              </div>
                              
                              {/* Gestures framework path check */}
                              <div className="mb-2">
                                <div className="flex items-center">
                                  <span className={`mr-2 ${hasIssuesForCheckType(file, 'gestures-framework') ? 'text-amber-600' : 'text-green-600'}`}>
                                    {hasIssuesForCheckType(file, 'gestures-framework') ? '⚠️' : '✓'}
                                  </span>
                                  <span>{CHECK_DESCRIPTIONS['gestures-framework']}</span>
                                </div>
                                
                                {hasIssuesForCheckType(file, 'gestures-framework') && (
                                  <div className="mt-2 pl-6">
                                    <span className="text-sm font-medium">Found issues:</span>
                                    <ul className="list-disc pl-5 space-y-1 mt-1 text-sm">
                                      {getIssuesByCheckType(file, 'gestures-framework').map((issue, idx) => (
                                        <li key={idx}>
                                          Line {issue.line}: <code className="bg-amber-50 p-1 rounded">{issue.importStatement}</code>
                                        </li>
                                      ))}
                                    </ul>
                                  </div>
                                )}
                              </div>
                              
                              {/* Getter method types check */}
                              <div className="mb-2">
                                <div className="flex items-center">
                                  <span className={`mr-2 ${hasIssuesForCheckType(file, 'getter-type') ? 'text-amber-600' : 'text-green-600'}`}>
                                    {hasIssuesForCheckType(file, 'getter-type') ? '⚠️' : '✓'}
                                  </span>
                                  <span>{CHECK_DESCRIPTIONS['getter-type']}</span>
                                </div>
                                
                                {hasIssuesForCheckType(file, 'getter-type') && (
                                  <div className="mt-2 pl-6">
                                    <span className="text-sm font-medium">Found issues:</span>
                                    <ul className="list-disc pl-5 space-y-1 mt-1 text-sm">
                                      {getIssuesByCheckType(file, 'getter-type').map((issue, idx) => (
                                        <li key={idx}>
                                          Line {issue.line}: <code className="bg-amber-50 p-1 rounded">{issue.importStatement}</code>
                                        </li>
                                      ))}
                                    </ul>
                                  </div>
                                )}
                              </div>

                              {/* Fixtures framework path check */}
                              <div className="mb-2">
                                <div className="flex items-center">
                                  <span className={`mr-2 ${hasIssuesForCheckType(file, 'fixtures-framework') ? 'text-amber-600' : 'text-green-600'}`}>
                                    {hasIssuesForCheckType(file, 'fixtures-framework') ? '⚠️' : '✓'}
                                  </span>
                                  <span>{CHECK_DESCRIPTIONS['fixtures-framework']}</span>
                                </div>
                                
                                {hasIssuesForCheckType(file, 'fixtures-framework') && (
                                  <div className="mt-2 pl-6">
                                    <span className="text-sm font-medium">Found issues:</span>
                                    <ul className="list-disc pl-5 space-y-1 mt-1 text-sm">
                                      {getIssuesByCheckType(file, 'fixtures-framework').map((issue, idx) => (
                                        <li key={idx}>
                                          Line {issue.line}: <code className="bg-amber-50 p-1 rounded">{issue.importStatement}</code>
                                        </li>
                                      ))}
                                    </ul>
                                  </div>
                                )}
                              </div>

                              {/* Test withFixtures check */}
                              <div className="mb-2">
                                <div className="flex items-center">
                                  <span className={`mr-2 ${hasIssuesForCheckType(file, 'test-withfixtures') ? 'text-amber-600' : 'text-green-600'}`}>
                                    {hasIssuesForCheckType(file, 'test-withfixtures') ? '⚠️' : '✓'}
                                  </span>
                                  <span>{CHECK_DESCRIPTIONS['test-withfixtures']}</span>
                                </div>
                                
                                {hasIssuesForCheckType(file, 'test-withfixtures') && (
                                  <div className="mt-2 pl-6">
                                    <span className="text-sm font-medium">Found issues:</span>
                                    <ul className="list-disc pl-5 space-y-1 mt-1 text-sm">
                                      {getIssuesByCheckType(file, 'test-withfixtures').map((issue, idx) => (
                                        <li key={idx}>
                                          Line {issue.line}: <code className="bg-amber-50 p-1 rounded">{issue.importStatement}</code>
                                        </li>
                                      ))}
                                    </ul>
                                  </div>
                                )}
                              </div>

                              {/* Matchers framework path check */}
                              <div className="mb-2">
                                <div className="flex items-center">
                                  <span className={`mr-2 ${hasIssuesForCheckType(file, 'matchers-framework') ? 'text-amber-600' : 'text-green-600'}`}>
                                    {hasIssuesForCheckType(file, 'matchers-framework') ? '⚠️' : '✓'}
                                  </span>
                                  <span>{CHECK_DESCRIPTIONS['matchers-framework']}</span>
                                </div>
                                
                                {hasIssuesForCheckType(file, 'matchers-framework') && (
                                  <div className="mt-2 pl-6">
                                    <span className="text-sm font-medium">Found issues:</span>
                                    <ul className="list-disc pl-5 space-y-1 mt-1 text-sm">
                                      {getIssuesByCheckType(file, 'matchers-framework').map((issue, idx) => (
                                        <li key={idx}>
                                          Line {issue.line}: <code className="bg-amber-50 p-1 rounded">{issue.importStatement}</code>
                                        </li>
                                      ))}
                                    </ul>
                                  </div>
                                )}
                              </div>
                            </div>
                          </div>
                        )}
                      </li>
                    );
                  })}
                </ul>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default PRValidator; 