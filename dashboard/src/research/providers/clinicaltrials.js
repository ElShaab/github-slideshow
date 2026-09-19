'use strict';

const client = require('../client');

const BASE = 'https://clinicaltrials.gov/api/v2/studies';

function firstDate(struct) {
  if (!struct) return null;
  const raw = typeof struct === 'string' ? struct : struct.date;
  if (!raw) return null;
  const year = Number(String(raw).slice(0, 4));
  return Number.isFinite(year) ? year : null;
}

async function search(terms, options = {}) {
  const limit = Math.min(Math.max(Number(options.limit) || 20, 1), 50);
  const params = new URLSearchParams({
    'query.term': terms.join(' OR '),
    pageSize: String(limit),
    format: 'json',
  });

  const { data } = await client.get('clinicaltrials', `${BASE}?${params}`, {
    minIntervalMs: 300,
  });

  const studies = (data && data.studies) || [];
  return studies
    .map((study) => {
      const protocol = study.protocolSection || {};
      const identification = protocol.identificationModule || {};
      const status = protocol.statusModule || {};
      const design = protocol.designModule || {};
      const description = protocol.descriptionModule || {};
      const sponsor =
        (protocol.sponsorCollaboratorsModule &&
          protocol.sponsorCollaboratorsModule.leadSponsor &&
          protocol.sponsorCollaboratorsModule.leadSponsor.name) ||
        null;
      const nctId = identification.nctId;
      if (!nctId) return null;

      const phases = design.phases || [];
      const allocation = (design.designInfo && design.designInfo.allocation) || null;

      return {
        source: 'clinicaltrials',
        title: client.stripMarkup(
          identification.briefTitle || identification.officialTitle
        ),
        abstract: description.briefSummary
          ? client.stripMarkup(description.briefSummary)
          : null,
        venue: sponsor ? `ClinicalTrials.gov - ${sponsor}` : 'ClinicalTrials.gov',
        year:
          firstDate(status.startDateStruct) ||
          firstDate(status.completionDateStruct) ||
          firstDate(status.studyFirstSubmitDate),
        doi: null,
        nct_id: nctId,
        url: `https://clinicaltrials.gov/study/${nctId}`,
        authors: sponsor,
        citations: null,
        // Registrations are freely readable by definition.
        open_access: true,
        publication_types: [design.studyType, allocation, ...phases].filter(Boolean),
        type: design.studyType || null,
        study_type: design.studyType || null,
        allocation,
        // Marks this as a registration rather than published results, which
        // the evidence grader and the UI both key off.
        registry: true,
        status: status.overallStatus || null,
        phases,
      };
    })
    .filter(Boolean);
}

module.exports = { id: 'clinicaltrials', label: 'ClinicalTrials.gov', search };
