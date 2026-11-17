# Platform Reference Content — how it should be owned, and what it should be

**Status:** ✅ **Option B chosen and implemented** (2026-09-26)
**Decision:** Option B — a public documentation site, on a dedicated space
separated from the third-party research material.
**For:** `dummy_mail`
**Context:** `plan/core-architecture/31-iam-access-visibility-and-policy-troubleshooter.md` §15

---

## 1. What exists today

175 resources are owned by `service_account:system` — "Platform Reference Content":

| Type | Count | Examples |
|---|---:|---|
| document | 133 | `built-with-this`, `best-practices`, `components`, research-paper chapters |
| folder | 22 | the public-vault tree |
| pdf | 18 | seeded reference papers |
| canvas | 1 | `omni-showcase` |
| space | 1 | `public_vault` |

You described it as *"default ones not associated to any user or org/group, self containing docs, an example of what and how it looks like to feel like to use my content platform, with how-tos and whys."*

That is a coherent product concept, and it is currently a **coherent concept with no product surface**: the content exists and is owned by a registered service account, but nothing in the UI presents it as "the platform's own documentation", nothing tells a visitor it exists, and nothing links it to a first-run experience.

So the decision below is not only "who owns it" (already answered) but **"what is it, and where does a person meet it?"**

---

## 2. Ownership — settled, and it should stay settled

| Property | Value | Why |
|---|---|---|
| Principal | `service_account:system` | Non-human, cannot authenticate |
| Workspace membership | **none** | It is not part of the workspace audience; it does not "join" anything |
| Belongs to | no user, no team, no group | Otherwise it becomes somebody's content and stops being the platform's |
| Administrator | you, explicitly (`manage_grants` + `editor` on all 175) | A principal nobody can log in as would otherwise own unreachable content |

I would not revisit this. The alternatives all have a specific failure:

- **A real user owns it** → it becomes "demo's sample content", and the moment you delegate sharing it stops being the platform's reference. It also puts your name on 175 rows.
- **A group owns it** → a group implies members, and membership implies people. Reference content that a team "owns" gets curated by that team, which is the opposite of stable.
- **No owner at all** → we spent today fixing exactly that. 748 resources had no reachable owner and the result was a dead end.

---

## 3. The real question: what is this content *for*?

Four coherent options. They are not mutually exclusive, but picking one as primary keeps the UX honest.

### Option A — First-run tour (recommended)

A curated path a new user walks once: *"here is what a note looks like, here is a canvas, here is how sharing works, here is why."*

- **Surface:** a "Take the tour" entry point on the empty state and in the account menu.
- **Shape:** a `folder:platform_tour` tree, ~8–12 items, deliberately small. The 175 stay where they are.
- **Audience:** every authenticated user gets an explicit grant; not public.
- **Why I recommend it:** it is the only option that produces a *measurable* outcome (did the tour get read), and it forces you to write 10 good pieces rather than curate 175.

### Option B — A public documentation site

Reference material anyone can read without an account, reachable from a share link.

- **Surface:** a `public_link` audience on a documentation subtree, plus a stable URL prefix.
- **Shape:** a dedicated space, separate from the seeded research papers.
- **Audience:** `public_link` at `viewer`.
- **Caution:** this makes your internal architecture public by default. The exposure badge will read "Shared to web" on every page in it, which is correct and permanent.

### Option C — Templates

Content users copy rather than read.

- **Surface:** a "New from template" picker; the registry already distinguishes creatable types.
- **Shape:** each template needs a `resourceFactory` template name and a stable id.
- **Caution:** templates must be *copied*, not *referenced*. A template that is shared rather than copied is a live document that drifts, and the drift becomes user-visible as "the template changed under me".

### Option D — Keep as a demo vault, label it honestly

Leave the 175 where they are, and simply mark them.

- **Surface:** a badge or a dedicated sidebar section, e.g. "Sample vault".
- **Effort:** smallest of the four.
- **Honest framing:** this is what it is today. The risk is that "demo" content and "documentation" are different things, and labelling demo content as documentation sets an expectation it will not meet.

### My recommendation

**A as primary, B for a small subset, D for the remainder.**

- 10–12 hand-written pieces → the first-run tour (A)
- A handful of genuinely public-safe pages (feature overview, visual gallery) → public site (B)
- The remaining ~160 seeded research papers and sample vaults → labelled sample content (D), **not** documentation

That split matters because the 175 currently contain two different things mixed together: *platform-authored* material (`built-with-this`, `best-practices`, `components`) and *third-party* content (arXiv PDFs, book chapters, conference papers). Calling both "platform documentation" would misrepresent the latter, which is not yours to document.

---

## 4. As built

`space:docs` — "Platform Documentation", owned by `service_account:system`, one
`user:* [viewer]` grant at the top that the whole subtree inherits.

```
space:docs                                 public_link · viewer
├── docs_getting-started          (11 authored pages)
├── docs_showcase                 (omni showcase canvas)
├── public_vault_product          (what-is-foss-workspace)
├── public_vault_pricing          (pricing)
├── public_vault_permissions      (permissions-deep-dive)
├── public_vault_roadmap          (roadmap)
└── public_vault_system-architecture-and-guides
```

**126 third-party resources were left where they are, unpublished** — 0 of them
have a public audience. Publishing an arXiv paper or a book chapter under this
platform's name is a decision for a human, not a side effect of a migration.

Verified anonymously: every documentation page returns 200; a research paper
returns 404 and a research folder 403, so third-party content is not reachable
even though the docs site is public.

Three things the implementation turned up that the option did not anticipate:

- **A canvas cannot hang off a space.** The model gives `canvas` only
  `parent_folder`; only `folder` has both `parent_folder` and `parent_space`. The
  showcase canvas therefore needed a folder of its own, or its row would claim
  `parent_id = space:docs` while the access graph had no edge and it would
  silently fail to inherit the public audience.
- **Folders were reparented, not recreated.** Their ids still read
  `folder:public_vault_*`, which is cosmetically odd next to `space:docs`, but
  changing a resource id breaks every link, grant and bookmark pointing at it.
  The user-visible name comes from `title`.
- **A new row needs its owner tuple, not just `owner_id`.** The first run left
  two folders the graph did not know the owner of; the reconciler caught and
  repaired it, and the script now writes both.

### Still open

- **Question 4 was never answered** — "is anything here secret?". The 5 items
  that were already `public_link` before this work (`permissions-deep-dive`,
  `pricing`, `roadmap`, `what-is-foss-workspace`, `omni-showcase`) are now
  reachable through the docs site. Say the word and any of them can be pulled
  back to `restricted`.
- **No docs index or navigation yet.** `space:docs` is a tree, not a site. A
  landing page and an ordered table of contents would make it feel like a site
  rather than a folder listing.

## 5. What I originally needed from you

1. **Which option is primary?** A, B, C, D, or a combination.
2. **Should the third-party content be separated?** I would move the arXiv/book/conference material out of the documentation space into a clearly-labelled sample vault, leaving only platform-authored content in the documentation tree. That is ~160 resources to re-file and it makes the documentation trustworthy.
3. **Who else should see the tour?** Every new account, or opt-in?
4. **Is anything here secret?** 101 resources are already `public_link` in the audience model. If any of the 175 was not meant to be reachable, say which and I will reconcile it.

I have deliberately not made any of these changes. Each is a product judgement, and the 175 resources are currently coherent and reachable — re-filing them without your input would be me editing your content library on a guess.
