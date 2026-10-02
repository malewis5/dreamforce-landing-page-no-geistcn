import { NextRequest, NextResponse } from 'next/server';
import { validCmsAuthorization } from './lib/cms-auth';

export function proxy(request: NextRequest): NextResponse {
  const password = process.env.DEMO_CMS_PASSWORD;
  if (!password) {
    return new NextResponse('The conversation editor is not configured.', {
      status: 503, headers: { 'Cache-Control': 'no-store' },
    });
  }
  if (!validCmsAuthorization(request.headers.get('authorization'), password)) {
    return new NextResponse('Enter the conversation editor credentials.', {
      status: 401,
      headers: {
        'WWW-Authenticate': 'Basic realm="Conversation editor", charset="UTF-8"',
        'Cache-Control': 'no-store',
      },
    });
  }
  return NextResponse.next();
}

export const config = { matcher: ['/cms/:path*'] };
