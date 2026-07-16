import { withMermaid } from 'vitepress-plugin-mermaid';

import apiSidebar from '../api/typedoc-sidebar.json';

export default withMermaid({
  // GitHub Pages project site: https://<owner>.github.io/kraken-e2e/
  base: process.env['DOCS_BASE'] ?? '/kraken-e2e/',
  // typedoc copies package readmes into api/_media with repo-relative links;
  // those copies are not navigable pages. Real pages keep the dead-link gate.
  ignoreDeadLinks: [(url) => url.includes('adrs/') || url.includes('_media')],
  title: 'Kraken',
  description:
    'Multi-user, multi-device end-to-end testing — Android, iOS and Web choreographed in one scenario.',
  themeConfig: {
    search: { provider: 'local' },
    nav: [
      { text: 'Introduction', link: '/introduction/what-is-kraken' },
      { text: 'Getting Started', link: '/getting-started/installation' },
      { text: 'Guide', link: '/guide/configuration' },
      { text: 'Reference', link: '/reference/cli' },
      { text: 'API', link: '/api/' },
    ],
    sidebar: {
      '/introduction/': sidebarDocs(),
      '/getting-started/': sidebarDocs(),
      '/guide/': sidebarDocs(),
      '/best-practices/': sidebarDocs(),
      '/reference/': sidebarDocs(),
      '/examples/': sidebarDocs(),
      '/api/': [{ text: 'API', items: apiSidebar }],
    },
    outline: { level: [2, 3] },
    socialLinks: [{ icon: 'github', link: 'https://github.com/wareval0/kraken-e2e' }],
    footer: {
      message: 'Released under the GNU GPL v3.0.',
      copyright: 'The Software Design Lab — Universidad de los Andes',
    },
  },
});

function sidebarDocs() {
  return [
    {
      text: 'Introduction',
      collapsed: false,
      items: [
        { text: 'What is Kraken?', link: '/introduction/what-is-kraken' },
        { text: 'How Kraken works', link: '/introduction/how-kraken-works' },
      ],
    },
    {
      text: 'Getting started',
      collapsed: false,
      items: [
        { text: 'Installation', link: '/getting-started/installation' },
        { text: 'Your first project', link: '/getting-started/first-project' },
        { text: 'Your first scenario', link: '/getting-started/first-scenario' },
      ],
    },
    {
      text: 'Guide',
      collapsed: false,
      items: [
        { text: 'Configuration', link: '/guide/configuration' },
        { text: 'Writing features', link: '/guide/writing-features' },
        { text: 'Writing steps', link: '/guide/writing-steps' },
        { text: 'Signals', link: '/guide/signals' },
        { text: 'The session API', link: '/guide/session-api' },
        { text: 'Drivers', link: '/guide/drivers' },
        { text: 'Devices', link: '/guide/devices' },
        { text: 'The inspector', link: '/guide/inspect' },
        { text: 'Environment diagnosis', link: '/guide/doctor' },
        { text: 'Reports', link: '/guide/reports' },
        { text: 'Serving results', link: '/guide/serve' },
      ],
    },
    {
      text: 'Best practices',
      collapsed: false,
      items: [
        { text: 'Given/When/Then discipline', link: '/best-practices/given-when-then' },
        { text: 'Page & Screen Objects', link: '/best-practices/page-objects' },
        { text: 'Seeded test data', link: '/best-practices/test-data' },
        { text: 'Monkey testing', link: '/best-practices/monkey-testing' },
      ],
    },
    {
      text: 'Reference',
      collapsed: true,
      items: [
        { text: 'CLI', link: '/reference/cli' },
        { text: 'Configuration', link: '/reference/configuration' },
        { text: 'Error codes', link: '/reference/error-codes' },
        { text: 'Events', link: '/reference/events' },
        { text: 'Packages', link: '/reference/packages' },
      ],
    },
    {
      text: 'Examples',
      collapsed: true,
      items: [
        { text: 'Overview', link: '/examples/overview' },
        { text: 'Live Kahoot (cross-device)', link: '/examples/kahoot' },
        { text: 'The showcase', link: '/examples/showcase' },
      ],
    },
  ];
}
