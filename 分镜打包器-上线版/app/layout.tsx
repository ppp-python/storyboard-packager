import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: '分镜命名打包器｜本地视频编排与导出',
  description:
    '在浏览器本地整理主分镜与补镜头，自动生成规范文件名，并导出 ZIP 或直接写入文件夹。视频绝不上传。',
  applicationName: 'storyboard-packager',
  creator: 'sk0l',
  publisher: 'sk0l',
  keywords: ['分镜', '视频命名', '批量打包', '本地处理', 'ZIP'],
  authors: [{ name: '分镜命名打包器' }],
  openGraph: {
    type: 'website',
    locale: 'zh_CN',
    title: '分镜命名打包器',
    description: '视频不上传：本地编排主镜头与补镜头，一键规范命名并打包。',
  },
  twitter: {
    card: 'summary_large_image',
    title: '分镜命名打包器',
    description: '视频不上传：本地编排主镜头与补镜头，一键规范命名并打包。',
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="zh-CN">
      <body>{children}</body>
    </html>
  );
}
