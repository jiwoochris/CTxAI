/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // 팀 대시보드가 /team 에서 루트(/)로 옮겨졌습니다. 예전 링크·북마크가 죽지 않도록.
  async redirects() {
    return [
      { source: "/team", destination: "/", permanent: false },
      { source: "/team/tool", destination: "/tool", permanent: false },
      { source: "/team/selftest", destination: "/selftest", permanent: false },
    ];
  },
};

export default nextConfig;
