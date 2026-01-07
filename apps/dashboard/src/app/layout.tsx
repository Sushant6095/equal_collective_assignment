export const metadata = {
  title: 'X-Ray Dashboard',
  description: 'Decision observability dashboard',
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body style={{ fontFamily: 'system-ui, sans-serif', margin: 0, padding: '20px' }}>
        {children}
      </body>
    </html>
  );
}

