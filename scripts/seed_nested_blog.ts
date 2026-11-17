import 'dotenv/config';
import { query } from '../src/lib/db';
import { fgaClient, writeTuples, PUBLIC_USER } from '../src/lib/openfga';

async function seedNestedBlog() {
  console.log('[Seed] Seeding nested blog hierarchy into PostgreSQL and OpenFGA...');

  const superAdmin = 'user:dummy_mail';

  // 1. Ensure user exists
  await query(
    `INSERT INTO users (id, email, display_name, is_active)
     VALUES ($1, $2, $3, TRUE)
     ON CONFLICT (id) DO UPDATE SET display_name = EXCLUDED.display_name`,
    [superAdmin, 'dummy_mail', 'DUMMY_NAME']
  );

  // 2. Clear previous demo resources to prevent slug collisions
  await query(`DELETE FROM resources WHERE tenant_id = 'tenant_default'`);

  // 3. Define the nested resource hierarchy
  const resourcesToInsert = [
    // Space (root)
    {
      id: 'space:main-blog',
      type: 'space',
      slug: 'main-blog',
      parent_id: null,
      owner_id: superAdmin,
      path: 'space:main-blog',
      title: 'Demo’s Research & Engineering Blog',
      is_public: true,
      metadata: {
        description: 'Deep dives into distributed systems, AI architectures, and fine-grained authorization.',
      },
    },

    // Level 1 Collection: Research
    {
      id: 'collection:research',
      type: 'collection',
      slug: 'research',
      parent_id: 'space:main-blog',
      owner_id: superAdmin,
      path: 'space:main-blog/collection:research',
      title: 'AI & Research Lab',
      is_public: true,
      metadata: {
        description: 'Explorations in modern machine learning, attention mechanisms, and deep neural architectures.',
      },
    },

    // Level 2 Nested Collection: Deep Learning (under Research)
    {
      id: 'collection:deep-learning',
      type: 'collection',
      slug: 'deep-learning',
      parent_id: 'collection:research',
      owner_id: superAdmin,
      path: 'space:main-blog/collection:research/collection:deep-learning',
      title: 'Deep Learning Architectures',
      is_public: true,
      metadata: {
        description: 'Foundational theory and implementation details of deep neural networks.',
      },
    },

    // Level 3 Deeply Nested Collection: Transformers (under Deep Learning)
    {
      id: 'collection:transformers',
      type: 'collection',
      slug: 'transformers',
      parent_id: 'collection:deep-learning',
      owner_id: superAdmin,
      path: 'space:main-blog/collection:research/collection:deep-learning/collection:transformers',
      title: 'Transformers & Self-Attention',
      is_public: true,
      metadata: {
        description: 'FlashAttention, multi-head latent attention, and sequence length scaling.',
      },
    },

    // Level 4 Post: Scaling Laws (inside Transformers collection)
    {
      id: 'post:scaling-laws',
      type: 'post',
      slug: 'scaling-laws',
      parent_id: 'collection:transformers',
      owner_id: superAdmin,
      path: 'space:main-blog/collection:research/collection:deep-learning/collection:transformers/post:scaling-laws',
      title: 'Empirical Scaling Laws in Modern LLMs',
      is_public: true,
      published_at: new Date(),
      metadata: {
        excerpt: 'An analysis of compute-optimal training tokens and power-law scaling across parameter counts.',
        tags: ['ai', 'transformers', 'scaling'],
        reading_time: '7 min read',
        summary: `
# Empirical Scaling Laws in Modern Large Language Models

Scaling laws govern the relationship between compute budget ($C$), parameter count ($N$), and dataset size in tokens ($D$). 

## Chinchilla Optimal Compute Formulation

Kaplan et al. initially proposed that model size should scale faster than training tokens ($N \\sim C^{0.73}, D \\sim C^{0.27}$). However, Hoffmann et al. (2022) revised this with the compute-optimal Chinchilla formulation:

$$L(N, D) = E + \\frac{A}{N^\\alpha} + \\frac{B}{D^\\beta}$$

Where:
- $E$ is the irreducible entropy of natural language
- $N$ is the number of non-embedding model parameters
- $D$ is the number of training tokens
- $\\alpha \\approx 0.34, \\beta \\approx 0.28$

### Key Implications
1. **Equal Scaling**: For a compute budget increase of $X$, both model parameters and training tokens should increase roughly equally ($\sim X^{0.5}$).
2. **Inference Tradeoff**: Training past compute-optimality (overtraining) dramatically lowers inference latency and serving costs.

\`\`\`python
def chinchilla_optimal_tokens(compute_flops: float) -> tuple[float, float]:
    """Calculate optimal parameters N and tokens D given compute budget C."""
    n_params = 0.6 * (compute_flops ** 0.5)
    n_tokens = 0.6 * (compute_flops ** 0.5)
    return n_params, n_tokens
\`\`\`
`,
      },
    },

    // Level 2 Nested Post: Diffusion Models (inside Deep Learning collection)
    {
      id: 'post:diffusion-models',
      type: 'post',
      slug: 'diffusion-models',
      parent_id: 'collection:deep-learning',
      owner_id: superAdmin,
      path: 'space:main-blog/collection:research/collection:deep-learning/post:diffusion-models',
      title: 'Score-Based Generative Modeling & Diffusion',
      is_public: true,
      published_at: new Date(),
      metadata: {
        excerpt: 'Denoising diffusion probabilistic models (DDPM) mapped from stochastic differential equations.',
        tags: ['diffusion', 'math', 'generative'],
        reading_time: '5 min read',
        summary: `
# Score-Based Generative Modeling

Diffusion models define a forward process that incrementally perturbs data towards Gaussian noise, and learn a reverse process that reconstructs samples.

## Stochastic Differential Equation (SDE) Formulation

The forward noising process is given by the Itô SDE:

$$\\mathrm{d}\\mathbf{x} = \\mathbf{f}(\\mathbf{x}, t)\\mathrm{d}t + g(t)\\mathrm{d}\\mathbf{w}$$

The reverse-time SDE solved by the neural network score function $\\mathbf{s}_\\theta(\\mathbf{x}, t) \\approx \\nabla_\\mathbf{x} \\log p_t(\\mathbf{x})$ is:

$$\\mathrm{d}\\mathbf{x} = \\left[ \\mathbf{f}(\\mathbf{x}, t) - g(t)^2 \\nabla_\\mathbf{x} \\log p_t(\\mathbf{x}) \\right] \\mathrm{d}t + g(t)\\mathrm{d}\\bar{\\mathbf{w}}$$
`,
      },
    },

    // Level 1 Collection: Engineering
    {
      id: 'collection:engineering',
      type: 'collection',
      slug: 'engineering',
      parent_id: 'space:main-blog',
      owner_id: superAdmin,
      path: 'space:main-blog/collection:engineering',
      title: 'Systems & Engineering',
      is_public: true,
      metadata: {
        description: 'Zero-trust security, distributed consensus, and fine-grained authorization.',
      },
    },

    // Level 2 Post: OpenFGA & Zanzibar (inside Engineering)
    {
      id: 'post:openfga-zanzibar',
      type: 'post',
      slug: 'openfga-zanzibar',
      parent_id: 'collection:engineering',
      owner_id: superAdmin,
      path: 'space:main-blog/collection:engineering/post:openfga-zanzibar',
      title: 'Zanzibar Re-imagined: OpenFGA in Production',
      is_public: true,
      published_at: new Date(),
      metadata: {
        excerpt: 'How relationship-based access control (ReBAC) enables hierarchical deny-first access evaluation.',
        tags: ['openfga', 'zanzibar', 'security', 'rebac'],
        reading_time: '6 min read',
        summary: `
# Zanzibar Re-imagined: Relationship-Based Access Control

Traditional Role-Based Access Control (RBAC) breaks down when access depends on object hierarchies, folder trees, and nested collections.

## Zanzibar Core Principles

1. **Everything is a Tuple**: \`{ user, relation, object }\`
2. **Dynamic Traversal**: A user has \`viewer\` on a document if they have \`viewer\` on any ancestor collection or space.
3. **Deny Overrides**: Explicit \`denied_viewer\` relations preempt all inherited grants.

\`\`\`
Space: main-blog [owner: Demo]
  └── Collection: engineering [viewer: user:public]
        └── Post: openfga-zanzibar [inherits viewer: user:public]
\`\`\`
`,
      },
    },

    // Top-Level Post: Welcome (directly under Space, 0 collections)
    {
      id: 'post:welcome',
      type: 'post',
      slug: 'welcome',
      parent_id: 'space:main-blog',
      owner_id: superAdmin,
      path: 'space:main-blog/post:welcome',
      title: 'Welcome to the Permission-Native FOSS Platform',
      is_public: true,
      published_at: new Date(),
      metadata: {
        excerpt: 'A complete overview of the FOSS architecture featuring nested hierarchies and Zanzibar access control.',
        tags: ['welcome', 'foss', 'intro'],
        reading_time: '3 min read',
        summary: `
# Welcome to the FOSS Publishing Platform

This platform is engineered from the ground up around two core pillars:
1. **Arbitrary Hierarchy**: Nest collections, folders, and documents as deeply as required.
2. **Fine-Grained Authorization**: Every single node in the hierarchy is governed by OpenFGA.
`,
      },
    },
  ];

  // Insert into DB
  for (const r of resourcesToInsert) {
    await query(
      `INSERT INTO resources (id, type, slug, parent_id, owner_id, path, title, is_public, published_at, metadata)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
       ON CONFLICT (id) DO UPDATE SET
         slug = EXCLUDED.slug,
         parent_id = EXCLUDED.parent_id,
         title = EXCLUDED.title,
         is_public = EXCLUDED.is_public,
         published_at = EXCLUDED.published_at,
         metadata = EXCLUDED.metadata`,
      [
        r.id,
        r.type,
        r.slug,
        r.parent_id,
        r.owner_id,
        r.path,
        r.title,
        r.is_public,
        r.published_at || null,
        JSON.stringify(r.metadata),
      ]
    );
  }
  console.log(`[Seed] Inserted ${resourcesToInsert.length} resources into PostgreSQL.`);

  // 4. Write OpenFGA Tuples:
  // - Parent hierarchy relations (child#parent -> parent)
  // - Owner relations for superAdmin
  // - Public viewer relations where is_public is true
  const tuples: Array<{ user: string; relation: string; object: string }> = [];

  for (const r of resourcesToInsert) {
    // Owner grant
    tuples.push({ user: superAdmin, relation: 'owner', object: r.id });

    // Parent hierarchy tuple (enables inheritance)
    if (r.parent_id) {
      tuples.push({ user: r.parent_id, relation: 'parent', object: r.id });
    }

    // Public viewer grant
    if (r.is_public) {
      tuples.push({ user: PUBLIC_USER, relation: 'viewer', object: r.id });
    }
  }

  await writeTuples(tuples);
  console.log(`[Seed] Successfully synchronized ${tuples.length} tuples with OpenFGA!`);
}

seedNestedBlog()
  .then(() => {
    console.log('[Seed] All done!');
    process.exit(0);
  })
  .catch((err) => {
    console.error('[Seed Error]:', err);
    process.exit(1);
  });
