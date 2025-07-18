'use client';

import { useState } from 'react';
import PRValidator from '@/components/PRValidator';

export default function Home() {
  return (
    <main className="min-h-screen flex flex-col items-center justify-center p-4">
      <PRValidator />
    </main>
  );
}
