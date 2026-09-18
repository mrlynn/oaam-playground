import type {SidebarsConfig} from '@docusaurus/plugin-content-docs';

// Grouped the way the docs are written: learn, do, understand, look up. Then
// what building it taught us, and how it was built.
const sidebars: SidebarsConfig = {
  docs: [
    'README',
    {type: 'category', label: 'Tutorial', collapsed: false, items: ['tutorial/first-run']},
    {
      type: 'category',
      label: 'How-to',
      collapsed: false,
      items: ['how-to/demo', 'how-to/instrument-your-agent', 'how-to/operate'],
    },
    {
      type: 'category',
      label: 'Explanation',
      collapsed: false,
      items: ['explanation/how-it-works', 'explanation/health-checks'],
    },
    {
      type: 'category',
      label: 'Reference',
      items: ['reference/inspector', 'reference/data-model', 'reference/dashboard', 'reference/scripts-and-config'],
    },
    {
      type: 'category',
      label: 'What we learned',
      items: ['friction', 'token-method', 'phase0-answers', 'schema-snapshot'],
    },
    {
      type: 'category',
      label: 'How it was built',
      items: ['plans/m2-thread-view', 'plans/m3-run-log', 'plans/m4-health', 'plans/docs-site'],
    },
  ],
};

export default sidebars;
