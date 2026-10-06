// Build-time renderer: turns the CV data into semantic HTML + structured data
// so search engines (and people without WebGL) get the full CV instantly.
import { cv, formatMonth, projects } from '../src/data/cv.ts';

const esc = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

const isoDate = (ym: string) => (ym.length === 4 ? ym : `${ym}-01`);

export function renderCvHtml(): string {
  const roles = cv.experience
    .map(
      (r) => `
      <article class="cv-role">
        <header>
          <h3>${esc(r.title)}</h3>
          <p class="cv-org">${esc(r.company)}${r.context ? ` — ${esc(r.context)}` : ''}</p>
          <p class="cv-dates"><time datetime="${isoDate(r.start)}">${formatMonth(r.start)}</time> – ${
            r.end ? `<time datetime="${isoDate(r.end)}">${formatMonth(r.end)}</time>` : 'Present'
          }</p>
        </header>
        <ul>
          ${r.highlights.map((h) => `<li><strong>${esc(h.label)}:</strong> ${esc(h.text)}</li>`).join('\n          ')}
        </ul>
        ${r.stack ? `<p class="cv-stack"><strong>Stack:</strong> ${esc(r.stack)}</p>` : ''}
      </article>`,
    )
    .join('');

  const skills = Object.entries(cv.skills)
    .map(
      ([group, items]) => `
        <div class="cv-skill-group">
          <h3>${esc(group)}</h3>
          <ul class="cv-tags">${items.map((s) => `<li>${esc(s)}</li>`).join('')}</ul>
        </div>`,
    )
    .join('');

  const projectList = projects
    .map((p) => `<li><strong>${esc(p.name)}</strong> <span class="cv-muted">(${esc(p.where)})</span> — ${esc(p.text)}</li>`)
    .join('\n        ');

  const e = cv.education;
  return `
    <header class="cv-head">
      <p class="cv-kicker">Curriculum Vitae</p>
      <h2 class="cv-name">${esc(cv.name)}</h2>
      <p class="cv-title">${esc(cv.title)}</p>
      <ul class="cv-contact">
        <li><a href="mailto:${esc(cv.email)}">${esc(cv.email)}</a></li>
        <li><a href="${cv.github}" rel="me noopener" target="_blank">GitHub</a></li>
        <li><a href="${cv.linkedin}" rel="me noopener" target="_blank">LinkedIn</a></li>
        <li><a href="${cv.cvPdf}" download>Download PDF</a></li>
      </ul>
    </header>

    <section aria-labelledby="cv-about">
      <h2 id="cv-about">Profile</h2>
      <p>${esc(cv.summary)}</p>
    </section>

    <section aria-labelledby="cv-experience">
      <h2 id="cv-experience">Professional Experience</h2>
      ${roles}
    </section>

    <section aria-labelledby="cv-projects">
      <h2 id="cv-projects">Selected Projects</h2>
      <ul>
        ${projectList}
      </ul>
    </section>

    <section aria-labelledby="cv-education">
      <h2 id="cv-education">Education</h2>
      <article class="cv-role">
        <header>
          <h3>${esc(e.degree)}</h3>
          <p class="cv-org">${esc(e.school)}</p>
          <p class="cv-dates"><time datetime="${e.start}">${e.start}</time> – <time datetime="${e.end}">${e.end}</time></p>
        </header>
        <ul>
          ${e.highlights.map((h) => `<li><strong>${esc(h.label)}:</strong> ${esc(h.text)}</li>`).join('\n          ')}
        </ul>
      </article>
    </section>

    <section aria-labelledby="cv-skills">
      <h2 id="cv-skills">Skills</h2>
      ${skills}
    </section>

    <section aria-labelledby="cv-languages">
      <h2 id="cv-languages">Languages</h2>
      <ul>
        ${cv.languages.map((l) => `<li><strong>${esc(l.name)}</strong> — ${esc(l.level)}</li>`).join('\n        ')}
      </ul>
    </section>`;
}

export function renderJsonLd(siteUrl: string): string {
  const allSkills = Object.values(cv.skills).flat();
  const person = {
    '@type': 'Person',
    '@id': `${siteUrl}/#person`,
    name: cv.name,
    givenName: cv.firstName,
    familyName: cv.lastName,
    jobTitle: cv.title,
    description: cv.summary,
    url: `${siteUrl}/`,
    image: `${siteUrl}/og-image.jpg`,
    email: `mailto:${cv.email}`,
    sameAs: [cv.github, cv.linkedin],
    knowsAbout: allSkills,
    knowsLanguage: cv.languages.map((l) => l.name),
    worksFor: { '@type': 'Organization', name: cv.experience[0].company },
    alumniOf: { '@type': 'CollegeOrUniversity', name: cv.education.school },
    hasOccupation: {
      '@type': 'Occupation',
      name: cv.title,
      skills: allSkills.join(', '),
    },
    award: ['LCPC Certificate', 'Qualified to ACPC (2021)'],
  };

  const graph = {
    '@context': 'https://schema.org',
    '@graph': [
      {
        '@type': 'ProfilePage',
        '@id': `${siteUrl}/#profile`,
        url: `${siteUrl}/`,
        name: `${cv.name} — ${cv.title}`,
        inLanguage: 'en',
        dateModified: new Date().toISOString().slice(0, 10),
        mainEntity: { '@id': `${siteUrl}/#person` },
      },
      person,
      {
        '@type': 'WebSite',
        '@id': `${siteUrl}/#website`,
        url: `${siteUrl}/`,
        name: `${cv.name} — Interactive CV`,
        publisher: { '@id': `${siteUrl}/#person` },
      },
    ],
  };
  // Escape "<" so the JSON can never close the script tag.
  return JSON.stringify(graph).replace(/</g, '\\u003c');
}
