import { describe, expect, it } from "vitest"
import request from "supertest"
import { createApp } from "./app.js"
import { MemoryStore } from "./store.js"
import { DisabledOcrProvider } from "./ocr.js"
import { UnconfiguredErpAdapter } from "./erp.js"
import { defaultDataset } from "./services.js"
import { signDevToken } from "./auth.js"
import { loadConfig } from "./config.js"

function makeTestApp() {
  const store = new MemoryStore()
  const config = loadConfig({
    AUTH_MODE: "local-dev",
    NODE_ENV: "development",
    AUTH_DEV_SIGNING_KEY: "test-signing-key-minimum-32-chars-long",
  })
  const app = createApp({
    config,
    store,
    ocr: new DisabledOcrProvider(),
    erp: new UnconfiguredErpAdapter(),
    data: defaultDataset(),
    erpDb: null,
  })
  const adminToken = signDevToken("test-signing-key-minimum-32-chars-long", "admin")
  const tunisToken = signDevToken("test-signing-key-minimum-32-chars-long", "commercial-tunis")
  const sfaxToken = signDevToken("test-signing-key-minimum-32-chars-long", "manager-sfax")
  return { app, adminToken, tunisToken, sfaxToken, store }
}

describe("Copilot Persistence & API", () => {
  it("creates, lists, retrieves, renames and deletes conversations", async () => {
    const { app, adminToken } = makeTestApp()

    // 1. Initially empty
    const list0 = await request(app)
      .get("/api/v1/conversations")
      .set("Authorization", `Bearer ${adminToken}`)
    expect(list0.status).toBe(200)
    expect(list0.body.conversations).toEqual([])

    // 2. Create conversation
    const createRes = await request(app)
      .post("/api/v1/conversations")
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ title: "Analyse des marges S1" })
    expect(createRes.status).toBe(201)
    const convId = createRes.body.id
    expect(convId).toBeDefined()
    expect(createRes.body.title).toBe("Analyse des marges S1")

    // 3. Ask question inside conversation
    const queryRes = await request(app)
      .post("/api/v1/copilot/query")
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ question: "Quel est le chiffre d'affaires total ?", conversationId: convId })
    expect(queryRes.status).toBe(200)
    expect(queryRes.body.status).toBe("ok")

    // 4. Retrieve conversation with turns
    const getRes = await request(app)
      .get(`/api/v1/conversations/${convId}`)
      .set("Authorization", `Bearer ${adminToken}`)
    expect(getRes.status).toBe(200)
    expect(getRes.body.messages.length).toBe(2)
    expect(getRes.body.messages[0].role).toBe("user")
    expect(getRes.body.messages[1].role).toBe("assistant")

    // 5. Rename conversation
    const patchRes = await request(app)
      .patch(`/api/v1/conversations/${convId}`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ title: "Titre Modifié" })
    expect(patchRes.status).toBe(200)
    expect(patchRes.body.title).toBe("Titre Modifié")

    // 6. Search conversations
    const searchRes = await request(app)
      .get("/api/v1/conversations?q=Modifié")
      .set("Authorization", `Bearer ${adminToken}`)
    expect(searchRes.status).toBe(200)
    expect(searchRes.body.conversations.length).toBe(1)
    expect(searchRes.body.conversations[0].id).toBe(convId)

    // 7. Delete conversation
    const delRes = await request(app)
      .delete(`/api/v1/conversations/${convId}`)
      .set("Authorization", `Bearer ${adminToken}`)
    expect(delRes.status).toBe(200)
    expect(delRes.body.success).toBe(true)

    // 8. Confirm deleted
    const getDeleted = await request(app)
      .get(`/api/v1/conversations/${convId}`)
      .set("Authorization", `Bearer ${adminToken}`)
    expect(getDeleted.status).toBe(404)
  })

  it("enforces tenant and user isolation across conversations", async () => {
    const { app, adminToken, tunisToken } = makeTestApp()

    // Admin creates conversation
    const createRes = await request(app)
      .post("/api/v1/conversations")
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ title: "Secret Admin Conversation" })
    const convId = createRes.body.id

    // Commercial Tunis cannot access admin's conversation
    const crossAccess = await request(app)
      .get(`/api/v1/conversations/${convId}`)
      .set("Authorization", `Bearer ${tunisToken}`)
    expect(crossAccess.status).toBe(404)

    // Commercial Tunis cannot rename or delete admin's conversation
    const crossPatch = await request(app)
      .patch(`/api/v1/conversations/${convId}`)
      .set("Authorization", `Bearer ${tunisToken}`)
      .send({ title: "Hacked Title" })
    expect(crossPatch.status).toBe(404)

    const crossDel = await request(app)
      .delete(`/api/v1/conversations/${convId}`)
      .set("Authorization", `Bearer ${tunisToken}`)
    expect(crossDel.status).toBe(404)
  })

  it("handles user memory preferences with isolation", async () => {
    const { app, adminToken, tunisToken } = makeTestApp()

    // Set preference for admin
    const putRes = await request(app)
      .put("/api/v1/copilot/preferences")
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ key: "preferred_language", value: "fr" })
    expect(putRes.status).toBe(200)

    // Read preferences for admin
    const getRes = await request(app)
      .get("/api/v1/copilot/preferences")
      .set("Authorization", `Bearer ${adminToken}`)
    expect(getRes.status).toBe(200)
    expect(getRes.body.preferences.preferred_language).toBe("fr")

    // Tunis user sees empty preferences
    const tunisGet = await request(app)
      .get("/api/v1/copilot/preferences")
      .set("Authorization", `Bearer ${tunisToken}`)
    expect(tunisGet.status).toBe(200)
    expect(tunisGet.body.preferences.preferred_language).toBeUndefined()
  })

  it("streams copilot responses via SSE endpoint", async () => {
    const { app, adminToken } = makeTestApp()

    const streamRes = await request(app)
      .post("/api/v1/copilot/query/stream")
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ question: "Quel est le chiffre d'affaires total ?" })

    expect(streamRes.status).toBe(200)
    expect(streamRes.headers["content-type"]).toContain("text/event-stream")
    expect(streamRes.text).toContain("event: init")
    expect(streamRes.text).toContain("event: delta")
    expect(streamRes.text).toContain("event: done")
  })

  it("handles conversational greetings, introductions, and short inputs like 'hi'", async () => {
    const { app, adminToken } = makeTestApp()

    // 1. English greeting 'hello'
    const helloRes = await request(app)
      .post("/api/v1/copilot/query")
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ question: "hello" })

    expect(helloRes.status).toBe(200)
    expect(helloRes.body.status).toBe("ok")
    expect(helloRes.body.tool).toBe("conversation")
    expect(helloRes.body.answer).toContain("Bonjour ! Je suis **AI-NÉGOCE Copilot**")

    // 2. Tunisian greeting 'ahla'
    const tnRes = await request(app)
      .post("/api/v1/copilot/query")
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ question: "ahla" })

    expect(tnRes.status).toBe(200)
    expect(tnRes.body.status).toBe("ok")
    expect(tnRes.body.answer).toContain("AI-NÉGOCE Copilot")

    // 3. Polite acknowledgment 'merci'
    const thanksRes = await request(app)
      .post("/api/v1/copilot/query")
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ question: "merci" })

    expect(thanksRes.status).toBe(200)
    expect(thanksRes.body.status).toBe("ok")
    expect(thanksRes.body.answer).toContain("Je vous en prie")
    expect(thanksRes.body.sources).toEqual([])

    // 4. French casual 'comme cv ?'
    const cvRes = await request(app)
      .post("/api/v1/copilot/query")
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ question: "comme cv ?" })

    expect(cvRes.status).toBe(200)
    expect(cvRes.body.status).toBe("ok")
    expect(cvRes.body.tool).toBe("conversation")
    expect(cvRes.body.answer).toContain("Ça va très bien, merci !")
    expect(cvRes.body.sources).toEqual([])

    // 5. Tunisian Arabic 'chnowa ahwelek ?'
    const tnAhwelRes = await request(app)
      .post("/api/v1/copilot/query")
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ question: "chnowa ahwelek ?" })

    expect(tnAhwelRes.status).toBe(200)
    expect(tnAhwelRes.body.status).toBe("ok")
    expect(tnAhwelRes.body.tool).toBe("conversation")
    expect(tnAhwelRes.body.answer).toContain("Labes el hamdullah")
    expect(tnAhwelRes.body.sources).toEqual([])
  })

  it("automatically creates a conversation and persists multi-turn dialogue when no conversationId is supplied", async () => {
    const { app, adminToken } = makeTestApp()

    // 1. Submit first question without conversationId
    const firstTurn = await request(app)
      .post("/api/v1/copilot/query")
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ question: "Quel est le chiffre d'affaires ?" })

    expect(firstTurn.status).toBe(200)
    expect(firstTurn.body.status).toBe("ok")
    const convId = firstTurn.body.conversationId
    expect(convId).toBeDefined()

    // 2. Conversation appears in sidebar listing
    const listRes = await request(app)
      .get("/api/v1/conversations")
      .set("Authorization", `Bearer ${adminToken}`)

    expect(listRes.status).toBe(200)
    expect(listRes.body.conversations.length).toBe(1)
    expect(listRes.body.conversations[0].id).toBe(convId)
    expect(listRes.body.conversations[0].title).toBe("Quel est le chiffre d'affaires ?")

    // 3. Submit follow-up question using the created conversationId
    const secondTurn = await request(app)
      .post("/api/v1/copilot/query")
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ question: "Et la marge brute ?", conversationId: convId })

    expect(secondTurn.status).toBe(200)
    expect(secondTurn.body.status).toBe("ok")

    // 4. Retrieve conversation detail: both turns are persisted
    const detail = await request(app)
      .get(`/api/v1/conversations/${convId}`)
      .set("Authorization", `Bearer ${adminToken}`)

    expect(detail.status).toBe(200)
    expect(detail.body.messages.length).toBe(4)
    expect(detail.body.messages[0].role).toBe("user")
    expect(detail.body.messages[0].content).toBe("Quel est le chiffre d'affaires ?")
    expect(detail.body.messages[1].role).toBe("assistant")
    expect(detail.body.messages[2].role).toBe("user")
    expect(detail.body.messages[2].content).toBe("Et la marge brute ?")
    expect(detail.body.messages[3].role).toBe("assistant")
  })
})
