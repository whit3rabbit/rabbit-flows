import { defineConfig } from 'astro/config';
import starlight from '@astrojs/starlight';

export default defineConfig({
  integrations: [
    starlight({
      title: 'rabbit-flows',
      description:
        'npx installer that bundles Claude Code dynamic workflows with the skills and agents they depend on.',
      social: [
        { icon: 'github', label: 'GitHub', href: 'https://github.com/whit3rabbit/rabbit-flows' },
      ],
      sidebar: [
        { label: 'Guides', items: [{ autogenerate: { directory: 'guides' } }] },
        { label: 'Reference', items: [{ autogenerate: { directory: 'reference' } }] },
        { label: 'Explanation', items: [{ autogenerate: { directory: 'explanation' } }] },
      ],
    }),
  ],
});
