---
description: Formulate a context-rich question and consult the Oracles
allowed-tools: SlashCommand(/consult-the-oracles:oracle:*)
argument-hint: <topic or question>
---

# Oracle Consultation Assistant

The user wants to consult the Three Oracles about: **$ARGUMENTS**

Your task is simple:

1. **Formulate a comprehensive question** based on what you know or can discover about this topic
2. **Invoke the oracles** with your formulated question

## Step 1: Formulate the Question

Create a detailed question that includes:
- What the topic is about (based on your current context or quick investigation)
- Technical details (languages, frameworks, file paths if relevant)
- The specific guidance needed
- Any constraints or considerations

Remember: The Oracles can't see the conversation history. Paint the full picture in your question.

## Step 2: Consult the Oracles

Once you have your comprehensive question, invoke:

```
/consult-the-oracles:oracle <your formulated question>
```

Then read the scroll they provide and synthesize their wisdom for the user.
