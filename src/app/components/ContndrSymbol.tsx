// Contndr logo symbol — used in collapsed sidebar state
export function ContndrSymbol({ className = '' }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 83 75"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={className}
    >
      <path
        d="M58.7197 0V8.9748H73.9405V24.192H82.9153V0H58.7197Z"
        fill="currentColor"
      />
      <path
        d="M33.9552 8.9748H52.7004V0H30.24L0 30.24H12.69L33.9552 8.9748Z"
        fill="currentColor"
      />
      <path
        d="M73.9404 66.006H33.9552L12.69 44.7408H0L30.24 74.9808H82.9152V50.7888H73.9404V66.006Z"
        fill="currentColor"
      />
    </svg>
  );
}
