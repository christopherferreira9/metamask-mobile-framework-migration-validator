'use client';

import PRValidator from '@/components/PRValidator';
import ValidationRules from '@/components/ValidationRules';

export default function Home() {
  return (
    <main className="min-h-screen flex flex-col items-center justify-center p-4">
      <PRValidator />
      <ValidationRules />
    </main>
  );
}
