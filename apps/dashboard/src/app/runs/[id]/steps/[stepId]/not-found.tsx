import Link from 'next/link';

export default function NotFound() {
  return (
    <div>
      <h1>Step Not Found</h1>
      <p>The step you're looking for doesn't exist.</p>
      <Link href="/runs" style={{ color: '#0066cc' }}>
        ← Back to Runs
      </Link>
    </div>
  );
}

