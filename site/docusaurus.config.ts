import path from 'node:path';

import type * as Preset from '@docusaurus/preset-classic';
import type {Config} from '@docusaurus/types';
import {themes as prismThemes} from 'prism-react-renderer';

import remarkRepoLinks from './plugins/remark-repo-links.mjs';

// The site is a view over the repo: its docs are ../docs, read in place, and
// its replay uses the dashboard's own logic from ../web/src/lib.

const REPO = 'https://github.com/mrlynn/oaam-playground';

// SITE_MODE=demo builds the copy ./demo.sh serves behind the inspector at
// localhost:3000/docs, next to the chat and the inspector, with links to both.
// Its guide lives at /docs/guide/... rather than /docs/docs/.... The default is
// the GitHub Pages site.
const DEMO = process.env.SITE_MODE === 'demo';
const DOCS_ROUTE = DEMO ? 'guide' : 'docs';
// Same-origin pages outside this site. Docusaurus prefixes baseUrl to every link it
// builds (pathname:// included), so these are raw HTML items it passes through.
const app = (path: string, label: string) => ({
  type: 'html' as const, position: 'left' as const, value: `<a class="navbar__item navbar__link" href="${path}">${label}</a>`,
});
const repoDir = path.resolve(__dirname, '..');
const docsDir = path.join(repoDir, 'docs');

const config: Config = {
  title: DEMO ? 'Docs · Agent Memory Playground' : 'Agent memory inspector',
  tagline: 'See what an agent remembered, and why it said what it said.',
  favicon: 'img/favicon.svg',

  future: {
    v4: true,
  },

  url: DEMO ? 'http://localhost:3000' : 'https://mrlynn.github.io',
  baseUrl: DEMO ? '/docs/' : '/oaam-playground/',
  customFields: {docsRoute: DOCS_ROUTE, demo: DEMO},
  // In the demo, the chat as a floating panel on every page, served by the companion behind /chat.
  scripts: DEMO ? [{src: '/chat/widget.js', defer: true}] : [],
  organizationName: 'mrlynn',
  projectName: 'oaam-playground',
  trailingSlash: false,

  onBrokenLinks: 'throw',
  onBrokenAnchors: 'throw',

  markdown: {
    // .md stays CommonMark, exactly as GitHub reads it. Components live only in
    // .mdx files under site/.
    format: 'detect',
    hooks: {onBrokenMarkdownLinks: 'throw'},
  },

  i18n: {defaultLocale: 'en', locales: ['en']},

  presets: [
    [
      'classic',
      {
        docs: {
          path: docsDir,
          routeBasePath: DOCS_ROUTE,
          sidebarPath: './sidebars.ts',
          editUrl: `${REPO}/edit/main/docs/`,
          beforeDefaultRemarkPlugins: [[remarkRepoLinks, {docsDir, repoDir, blobBase: `${REPO}/blob/main`}]],
        },
        blog: false,
        theme: {customCss: './src/css/custom.css'},
      } satisfies Preset.Options,
    ],
  ],

  plugins: [
    () => ({
      name: 'inspector-lib',
      configureWebpack: () => ({
        resolve: {alias: {'@inspector/lib': path.join(repoDir, 'web/src/lib')}},
      }),
    }),
  ],

  themeConfig: {
    colorMode: {respectPrefersColorScheme: true},
    navbar: {
      // In the demo the brand goes to the playground's home (/), outside this site, so it's
      // the same markup as a raw HTML item instead of the built-in brand.
      ...(DEMO ? {} : {title: 'Agent memory inspector', logo: {alt: '', src: 'img/favicon.svg'}}),
      items: [
        ...(DEMO ? [
          {type: 'html' as const, position: 'left' as const,
           value: '<a class="navbar__brand" href="/"><b class="navbar__title text--truncate">Agent Memory Playground</b></a>'},
          app('/chat', 'Chat'), app('/runs', 'Runs'), app('/memories', 'Memory'),
        ] : []),
        {type: 'docSidebar', sidebarId: 'docs', position: 'left', label: 'Docs'},
        {to: '/replay', label: 'Replay', position: 'left'},
        {to: `/${DOCS_ROUTE}/friction`, label: 'What we learned', position: 'left'},
        {href: REPO, label: 'GitHub', position: 'right'},
      ],
    },
    footer: {
      style: 'light',
      copyright: `Michael Lynn · a personal work sample, built to learn <code>oracleagentmemory</code>. Not an Oracle product. Apache-2.0.`,
    },
    prism: {
      theme: prismThemes.github,
      darkTheme: prismThemes.dracula,
      additionalLanguages: ['bash', 'python', 'sql', 'json'],
    },
  } satisfies Preset.ThemeConfig,
};

export default config;
