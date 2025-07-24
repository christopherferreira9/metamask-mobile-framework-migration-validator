'use client';

import { useState } from 'react';

interface RuleInfo {
  id: string;
  title: string;
  description: string;
}

const ValidationRules: React.FC = () => {
  const [isOpen, setIsOpen] = useState(false);

  const rules: RuleInfo[] = [
    {
      id: 'assertions-framework',
      title: 'Assertions Framework Path',
      description: 'All Assertions imports must include the /framework path. This ensures that the correct framework version of the Assertions module is used.'
    },
    {
      id: 'assertions-no-ts',
      title: 'No .ts Extension in Assertions Imports',
      description: 'Assertions imports should not include the .ts file extension. TypeScript extensions should be omitted in import statements for better compatibility with bundlers.'
    },
    {
      id: 'gestures-framework',
      title: 'Gestures Framework Path',
      description: 'All gestures imports must include the /framework path. This ensures that the correct framework version of the gestures module is used.'
    },
    {
      id: 'fixtures-framework',
      title: 'withFixtures Framework Path',
      description: 'All withFixtures imports must come from /framework/fixtures. This ensures that the correct framework version of the fixtures module is used.'
    },
    {
      id: 'matchers-framework',
      title: 'Matchers Framework Path',
      description: 'All Matchers imports must include the /framework path. This ensures that the correct framework version of the Matchers module is used.'
    },
    {
      id: 'getter-type',
      title: 'Getter Method Types',
      description: 'Getter methods must have proper type prefixes or return type annotations. Valid types include DetoxElement, TappableElement, TypableElement, WebElement, IndexableNativeElement, NativeElement, SystemElement, DeviceLaunchAppConfig, DetoxMatcher, or Promise versions of these types.'
    },
    {
      id: 'test-withfixtures',
      title: 'Test Files with withFixtures',
      description: 'Every test file (ending in .spec.ts) must use withFixtures inside each it() block. This ensures that all tests are using the fixtures framework correctly.'
    }
  ];

  return (
    <div className="relative">
      {/* Info button */}
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="fixed bottom-4 right-4 bg-blue-600 text-white rounded-full p-3 shadow-lg hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500 z-10"
        aria-label="Validation Rules Info"
      >
        {isOpen ? (
          <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
          </svg>
        ) : (
          <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
        )}
      </button>

      {/* Rules panel */}
      {isOpen && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-20">
          <div className="bg-white rounded-lg shadow-xl max-w-3xl w-full max-h-[90vh] overflow-y-auto p-6 m-4">
            <div className="flex justify-between items-center mb-6">
              <h2 className="text-2xl font-bold text-gray-800">Validation Rules</h2>
              <button 
                onClick={() => setIsOpen(false)}
                className="text-gray-500 hover:text-gray-700"
              >
                <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
            
            <div className="space-y-6">
              <p className="text-gray-600">
                The PR Migration Validator checks for the following rules to ensure proper framework migration:
              </p>
              
              <div className="space-y-4">
                {rules.map(rule => (
                  <div key={rule.id} className="border border-gray-200 rounded-lg p-4">
                    <h3 className="font-semibold text-lg text-gray-800 mb-2">{rule.title}</h3>
                    <p className="text-gray-600">{rule.description}</p>
                  </div>
                ))}
              </div>
              
              <div className="bg-blue-50 border-l-4 border-blue-500 p-4 rounded">
                <div className="flex">
                  <div className="flex-shrink-0">
                    <svg className="h-5 w-5 text-blue-500" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor">
                      <path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7-4a1 1 0 11-2 0 1 1 0 012 0zM9 9a1 1 0 000 2v3a1 1 0 001 1h1a1 1 0 100-2h-1V9a1 1 0 00-1-1z" clipRule="evenodd" />
                    </svg>
                  </div>
                  <div className="ml-3">
                    <p className="text-sm text-blue-700">
                      These rules help ensure consistent usage of the framework modules across the codebase and proper test implementation.
                    </p>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default ValidationRules; 