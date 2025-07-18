import { validatePr } from '@/utils/prValidator';
import { NextRequest, NextResponse } from 'next/server';

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { prLink } = body;
    
    if (!prLink) {
      return NextResponse.json(
        { message: 'PR link is required' },
        { status: 400 }
      );
    }
    
    const validationResults = await validatePr(prLink);
    return NextResponse.json(validationResults);
    
  } catch (error: any) {
    console.error('Error in validation API:', error);
    return NextResponse.json(
      { message: error.message || 'An error occurred during validation' },
      { status: 500 }
    );
  }
} 