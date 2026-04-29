export function GmailIcon({ className = 'w-5 h-5' }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 88 66" fill="none" xmlns="http://www.w3.org/2000/svg">
      <g clipPath="url(#gmail-clip)">
        <path d="M6 66H20V32L0 17V60C0 63.32 2.69 66 6 66Z" fill="#4285F4"/>
        <path d="M68 66H82C85.32 66 88 63.31 88 60V17L68 32" fill="#34A853"/>
        <path d="M68 5.99993V31.9999L88 16.9999V8.99993C88 1.57993 79.53 -2.65007 73.6 1.79993" fill="#FBBC04"/>
        <path d="M20 32V6L44 24L68 6V32L44 50" fill="#EA4335"/>
        <path d="M0 8.99993V16.9999L20 31.9999V5.99993L14.4 1.79993C8.46 -2.65007 0 1.57993 0 8.99993Z" fill="#C5221F"/>
      </g>
      <defs>
        <clipPath id="gmail-clip">
          <rect width="88" height="66" fill="white"/>
        </clipPath>
      </defs>
    </svg>
  );
}
