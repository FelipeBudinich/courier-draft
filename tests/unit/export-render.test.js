import { describe, expect, it } from 'vitest';

import { resolveLayoutProfile } from '../../src/services/export/layout-profiles.js';
import { renderExportTemplate } from '../../src/services/export/template-render-service.js';
import { buildTitlePageModel } from '../../src/services/export/title-page-service.js';

describe('export templates', () => {
  it('renders title-page metadata into the standard export HTML', async () => {
    const titlePage = buildTitlePageModel({
      project: {
        name: 'Courier Pilot'
      },
      script: {
        title: 'Pilot Episode',
        authors: ['Olivia Owner', 'Eddie Editor'],
        currentVersionLabel: '1.2.3.4'
      },
      locale: 'en',
      exportDate: new Date('2026-04-10T00:00:00.000Z'),
      selection: {
        kind: 'full'
      }
    });
    const html = await renderExportTemplate({
      templateName: 'export/standard-pdf.njk',
      templateContext: {
        locale: 'en',
        project: {
          id: 'prj_1',
          name: 'Courier Pilot'
        },
        script: {
          id: 'scr_1',
          title: 'Pilot Episode'
        },
        titlePage,
        selection: {
          kind: 'full',
          selectedSceneIdSet: new Set()
        },
        layout: resolveLayoutProfile('standard'),
        pages: []
      },
      cssFiles: ['public/css/export-screenplay.css']
    });

    expect(html).toContain('Courier Pilot');
    expect(html).toContain('Pilot Episode');
    expect(html).toContain('Olivia Owner');
    expect(html).toContain('Eddie Editor');
    expect(html).toContain(titlePage.exportDateLabel);
    expect(html).toContain('Version 1.2.3.4');
  });
});

