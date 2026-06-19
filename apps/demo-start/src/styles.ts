export const styles = `
* { box-sizing: border-box; }
body {
  font-family: system-ui, -apple-system, sans-serif;
  margin: 0;
  background: #f5f7f8;
  color: #182025;
  line-height: 1.5;
}
.app { max-width: 720px; margin: 0 auto; padding: 24px; }
.nav {
  display: flex;
  gap: 16px;
  align-items: baseline;
  border-bottom: 1px solid #d8e0e4;
  padding-bottom: 12px;
  margin-bottom: 24px;
}
.nav nav { display: flex; gap: 12px; }
a { color: #0f766e; text-decoration: none; }
a:hover { text-decoration: underline; }
h1, h2 { line-height: 1.2; }
.loading { color: #60707a; font-style: italic; }
.post-list { line-height: 2; padding-left: 18px; }
.post { background: #fff; border: 1px solid #d8e0e4; border-radius: 8px; padding: 20px; }
.meta { color: #60707a; font-size: 0.875rem; }
`;
