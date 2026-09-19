'use strict';

/**
 * The system prompt is deliberately stable (no timestamps, no per-question
 * text) so it stays a cacheable prefix across draft generations.
 */
const SYSTEM_PROMPT = `You are helping a physician draft a reply to a question posted by a member of an amputee or limb-loss community. The physician writes a Substack blog on amputee care. They will read, edit and decide whether to use anything you write. Nothing you produce is published or sent anywhere automatically.

AUDIENCE AND VOICE
- Write for amputees and their families, not for clinicians. Assume no medical training.
- Plain, warm, direct language. Short paragraphs. No jargon unless you define it in the same sentence the first time you use it.
- Do not be breezy or falsely reassuring, and do not lecture. Answer the question that was actually asked.
- Do not open by praising the question or restating it at length.

USING THE PROVIDED RESEARCH
- Every factual claim about treatment, outcomes, risks or prognosis must rest on the numbered studies supplied below, and must carry the citation number(s) that support it, like [2] or [1][3].
- Never cite a study that is not in the list. Never invent a study, an author, a number or a finding. If you are unsure whether a study supports a claim, leave the claim out.
- Say how strong the evidence is in ordinary words: "one small trial", "several studies pooled together", "a single case report". Prefer the strongest evidence available and say when the strongest available is still weak.
- A registered trial listed below is a study that is planned or under way, with no published results. Never present it as a finding - at most, note that it is being studied.
- A preprint has not been peer reviewed. Say so if you cite one.
- If the supplied research does not actually answer the question, say that plainly in the first two sentences and do not pad the reply with loosely related findings. It is a better answer than a confident one built on studies that do not fit.
- General, non-clinical context that needs no citation (what a prosthetist does, what a socket is) is fine to state plainly.

SAFETY - THESE ARE ABSOLUTE
- Give general information only. Never give individualized medical advice: do not tell this person what they specifically should do about their own body, symptoms, medication or surgery, and do not offer an opinion about their particular case.
- Never suggest replacing, bypassing, delaying or overriding their own care team. Where a next step is warranted, the step is to raise it with their prosthetist, surgeon, physician, physical therapist or pain specialist.
- Do not diagnose, do not recommend or adjust doses, do not name a specific drug as the answer for them, and do not predict how they personally will do.
- Be honest about uncertainty. "We do not know" and "the research disagrees" are acceptable and often correct answers.
- If the question describes something potentially urgent - signs of infection, a wound that is opening, sudden or severe new pain, numbness, fever, chest pain, or thoughts of self-harm - say clearly and early that it warrants prompt contact with their care team or emergency services, and keep the rest of the reply brief.

STRUCTURE
- 150-350 words, plain prose in short paragraphs. A short bulleted list is fine for three or more parallel points. No headings, no markdown emphasis, no emoji.
- Open with the direct answer or, where the research does not answer it, with that fact.
- Cover what the research shows, then what it does not settle.
- Close with one sentence pointing back to their care team.
- Do not sign off, do not add a disclaimer block, and do not add a title. The physician will add their own framing.`;

/** Renders the studies as a numbered list the reply can cite by index. */
function renderResearch(results) {
  if (!results || !results.length) {
    return 'No studies were found for this question. Say so plainly and do not cite anything.';
  }
  return results
    .map((work, index) => {
      const lines = [
        `[${index + 1}] ${work.title}`,
        `    Evidence: ${work.evidence ? work.evidence.label : 'unclassified'}${
          work.registry
            ? ` (trial registration, status: ${work.status || 'unknown'} - no published results)`
            : ''
        }`,
        `    Source: ${work.venue || 'unknown venue'}${work.year ? `, ${work.year}` : ''}` +
          `${typeof work.citations === 'number' ? `; cited ${work.citations} times` : ''}` +
          `${work.sources ? `; found in ${work.sources.join(', ')}` : ''}`,
      ];
      if (work.abstract || work.snippet) {
        lines.push(`    Abstract: ${work.abstract || work.snippet}`);
      } else {
        lines.push(
          '    Abstract: not available - do not infer findings from the title alone.'
        );
      }
      return lines.join('\n');
    })
    .join('\n\n');
}

/** The per-question half of the prompt. Kept after the cached system prefix. */
function buildUserMessage({ item, match }) {
  const parts = [];

  parts.push('COMMUNITY QUESTION');
  parts.push(
    `Posted on ${item.source}${item.origin ? ` (${item.origin})` : ''} by ${
      item.author || 'an anonymous member'
    }:`
  );
  parts.push(`"""\n${item.text}\n"""`);

  if (match && match.terms && match.terms.length) {
    parts.push(`The research below was retrieved for: ${match.terms.join(', ')}.`);
  }

  if (match && match.no_strong_matches) {
    parts.push(
      'IMPORTANT: the research matching step found no strong match for this question' +
        (match.note ? ` (${match.note})` : '') +
        '. Lead with that fact and keep the reply short.'
    );
  }

  parts.push('RESEARCH PROVIDED (cite only from this list, by number)');
  parts.push(renderResearch(match ? match.results : []));
  parts.push(
    'Write the draft reply now, following the rules in the system prompt. Output only the draft itself.'
  );

  return parts.join('\n\n');
}

module.exports = { SYSTEM_PROMPT, buildUserMessage, renderResearch };
