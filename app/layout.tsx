import type { Metadata } from 'next';
import './globals.css';
export const metadata: Metadata = { title: 'Timeless Florence', description: '认识眼前的艺术，听见作品的故事。艺术作品介绍与中文讲解。', manifest: '/manifest.webmanifest' };
export default function RootLayout({ children }: { children: React.ReactNode }) { return <html lang="zh-CN" className="dark"><body>{children}</body></html>; }
