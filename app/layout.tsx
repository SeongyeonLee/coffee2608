export const metadata = {
  title: "Specialty Coffee Archive",
  description: "Track beans, brews, and recipes.",
}

export default function RootLayout({
  children,
}: {
  children: ReactNode
}) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  )
}
