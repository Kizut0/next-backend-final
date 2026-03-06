import "./globals.css";

export const metadata = {
  title: "Library Management Backend",
  description: "Operational backend for the library management system",
};

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
