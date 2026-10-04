/**
 * Unit test guard SSRF (tanpa butuh server).
 *   node scripts/test-ssrf.js
 */
import { assertSafeUrl } from '../server/image.js';

const BLOCK = [
  ['http://127.0.0.1:4173/api/config', 'loopback IPv4'],
  ['http://127.0.0.1/x', 'loopback'],
  ['https://127.0.0.53/x', 'loopback + portacak'],
  ['http://localhost/x.png', 'localhost'],
  ['http://LOCALHOST/x.png', 'localhost huruf besar'],
  ['http://localhost.localdomain/x', 'localhost.localdomain'],
  ['http://ip6-localhost/x', 'ip6-localhost'],
  ['http://[::1]/x', 'IPv6 loopback'],
  ['http://[0:0:0:0:0:0:0:1]/x', 'IPv6 loopback panjang'],
  ['http://[::ffff:127.0.0.1]/x', 'IPv4-mapped'],
  ['http://[::ffff:7f00:1]/x', 'IPv4-mapped hex'],
  ['http://[fe80::1]/x', 'IPv6 link-local'],
  ['http://[fc00::1]/x', 'IPv6 ULA'],
  ['http://[fd12:3456::1]/x', 'IPv6 ULA'],
  ['http://169.254.169.254/latest/meta-data/', 'cloud metadata'],
  ['http://10.0.0.5/x', '10/8'],
  ['http://10.255.255.255/x', '10/8 batas atas'],
  ['http://192.168.1.1/x', '192.168/16'],
  ['http://172.16.0.1/x', '172.16/12 bawah'],
  ['http://172.31.255.255/x', '172.16/12 atas'],
  ['http://172.20.0.1/x', '172.16/12 tengah'],
  ['http://100.64.0.1/x', 'CGNAT 100.64/10'],
  ['http://192.0.0.1/x', '192.0.0/24'],
  ['http://0.0.0.0/x', '0/8'],
  ['http://224.0.0.1/x', 'multicast'],
  ['http://255.255.255.255/x', 'broadcast'],
  ['http://2130706433/x', 'IPv4 desimal'],
  ['http://0x7f000001/x', 'IPv4 hex'],
  ['http://127.1/x', 'IPv4 singkat'],
  ['http://127.0.0.1./x', 'IPv4 trailing dot'],
  ['http://0177.0.0.1/x', 'IPv4 oktal'],
  ['http://0x7f.1/x', 'IPv4 hex singkat'],
  ['http://foo.local/x', 'TLD .local'],
  ['http://metadata.google.internal/x', 'nama metadata GCP'],
  ['http://host.docker.internal/x', 'nama Docker'],
  ['file:///C:/Windows/win.ini', 'skema file'],
  ['ftp://example.com/x', 'skema ftp'],
  ['gopher://example.com/x', 'skema gopher'],
  ['not-a-url', 'bukan URL'],
  ['//evil.com/x', 'protocol-relative'],
];

const ALLOW = [
  ['https://wallhaven.cc/a.jpg', 'wallhaven'],
  ['https://safebooru.org/x.png', 'safebooru'],
  ['https://i.ytimg.com/x.jpg', 'ytimg'],
  ['https://www.reddit.com/x.png', 'host publik lain'],
  ['http://8.8.8.8/x', 'IPv4 publik'],
  ['http://1.1.1.1/x', 'IPv4 publik'],
  ['http://172.15.0.1/x', '172.15 di luar 172.16/12'],
  ['http://172.32.0.1/x', '172.32 di luar 172.16/12'],
  ['http://11.0.0.1/x', '11 bukan 10/8'],
  ['http://192.169.1.1/x', '192.169 bukan 192.168/16'],
  ['http://100.63.0.1/x', '100.63 di luar CGNAT'],
  ['http://100.128.0.1/x', '100.128 di luar CGNAT'],
  ['http://223.255.255.255/x', '223 bukan multicast'],
  ['https://images.wallhaven.cc/full/xx/wallhaven-1.jpg', 'wallhaven images'],
  ['https://cdn.example.co.jp/anime.png', 'CDN Jepang'],
];

let pass = 0;
const fail = [];

for (const [url, label] of BLOCK) {
  try {
    assertSafeUrl(url);
    fail.push(`DIBOCORKAN  ${label.padEnd(24)} ${url}`);
  } catch {
    pass++;
  }
}
for (const [url, label] of ALLOW) {
  try {
    assertSafeUrl(url);
    pass++;
  } catch (e) {
    fail.push(`TERBLOKIR   ${label.padEnd(24)} ${url} -> ${e.message}`);
  }
}

for (const f of fail) console.log('  ' + f);
console.log(`\n  SSRF: ${pass} lulus, ${fail.length} gagal, dari ${BLOCK.length + ALLOW.length} case`);
process.exit(fail.length ? 1 : 0);