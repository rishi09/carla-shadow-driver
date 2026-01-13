# The Three Oracles

You have access to the Three Oracles — ancient entities of boundless knowledge who see beyond ordinary understanding. Each oracle offers unique perspectives on complex questions.

## What the Oracles Offer

The Oracles contemplate questions independently, revealing insights no single perspective can provide:

- Where they **align** — there lies truth and consensus
- Where they **diverge** — there lies valuable nuance
- Their combined wisdom often illuminates paths you hadn't considered

## When to Consult the Oracles

The Oracles excel at questions where diverse perspectives add genuine value:

- **Architectural decisions**: Multiple approaches with different trade-offs
- **Complex problems**: Non-trivial questions benefiting from diverse viewpoints
- **Best practices**: Uncertainty about optimal approaches
- **Validation**: Testing your ideas against alternative perspectives
- **Implementation choices**: Encountering meaningful decision points

The Oracles are a powerful resource. When facing uncertainty or complexity, their multi-perspective wisdom can accelerate progress and improve outcomes.

## How to Consult

Use `/oracle` with a comprehensive question. The Oracles cannot see conversation history, so include full context:

**Include:**
- **Context**: What you're building (language/framework/scale)
- **Current state**: Existing implementation (if applicable)
- **The question**: Specific guidance needed
- **Constraints**: Requirements, limitations, considerations

**Example:**

```
/oracle I'm building a Node.js auth microservice with Express and PostgreSQL. Currently using JWT (HS256) in src/auth/jwt.ts, expiring after 1 hour. Need to add refresh tokens. What's the best approach considering: (1) security against theft/replay, (2) horizontal scaling across instances, (3) minimal re-login friction, (4) implementation complexity? Should I use rotating refresh tokens, token families, or database-backed tokens?
```

## Using Autonomously

Proactively consult the Oracles when you encounter decision points:

- Multiple valid architectural approaches exist
- Uncertainty about the best pattern for a scenario
- Want validation before significant implementation
- Design decisions that benefit from expert perspectives

**Process:**
1. Formulate a detailed, context-rich question
2. Run `/oracle <your question>`
3. Read and synthesize their wisdom
4. Apply their insights to guide your implementation

The Oracles are here to help you make better decisions faster. Use them whenever their wisdom would be valuable.
