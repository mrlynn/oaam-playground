import path from 'node:path';

import type * as Preset from '@docusaurus/preset-classic';
import type {Config} from '@docusaurus/types';
import {themes as prismThemes} from 'prism-react-renderer';

import remarkRepoLinks from './plugins/remark-repo-links.mjs';

// The site is a view over the repo: its docs are ../docs, read in place, and
// its replay uses the dashboard's own logic from ../web/src/lib.

const REPO = 'https://github.com/mrlynn/oaam-playground';
const repoDir = path.resolve(__dirname, '..');
const docsDir = path.join(repoDir, 'docs');

const config: Config = {
  title: 'Agent memory inspector',
  tagline: 'See what an agent remembered, and why it said what it said.',
  favicon: 'img/favicon.svg',

  future: {
    v4: true,
  },

  url: 'https://mrlynn.github.io',
  baseUrl: '/oaam-playground/',
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
          routeBasePath: 'docs',
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
      title: 'Agent memory inspector',
      logo: {alt: '', src: 'img/favicon.svg'},
      items: [
        {to: '/replay', label: 'Replay', position: 'left'},
        {type: 'docSidebar', sidebarId: 'docs', position: 'left', label: 'Docs'},
        {to: '/docs/friction', label: 'What we learned', position: 'left'},
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
