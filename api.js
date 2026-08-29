'use strict';

/*
 * Stub data layer standing in for the future backend.
 * Every method returns a Promise with the same shape a real
 * fetch()-based implementation would, so swapping the bodies
 * below for HTTP calls later won't require touching call sites.
 */
const Api = (() => {
  const STORAGE_KEY = 'cyberbreach_questions_v1';
  const LATENCY_MS = 150;

  function delay(value) {
    return new Promise((resolve) => setTimeout(() => resolve(value), LATENCY_MS));
  }

  function readAll() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) return JSON.parse(raw);
    } catch (e) {
      /* fall through to defaults */
    }
    return JSON.parse(JSON.stringify(DEFAULT_QUESTIONS));
  }

  function writeAll(questions) {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(questions));
    } catch (e) {
      /* storage unavailable — edits won't persist across reloads */
    }
  }

  function generateId() {
    return 'q_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
  }

  return {
    async getQuestions() {
      return delay(readAll());
    },

    async getQuestion(id) {
      const question = readAll().find((q) => q.id === id) || null;
      return delay(question);
    },

    async createQuestion(question) {
      const questions = readAll();
      const created = Object.assign({}, question, { id: generateId() });
      questions.push(created);
      writeAll(questions);
      return delay(created);
    },

    async updateQuestion(id, patch) {
      const questions = readAll();
      const idx = questions.findIndex((q) => q.id === id);
      if (idx === -1) return delay(null);
      questions[idx] = Object.assign({}, questions[idx], patch, { id });
      writeAll(questions);
      return delay(questions[idx]);
    },

    async deleteQuestion(id) {
      const questions = readAll();
      const next = questions.filter((q) => q.id !== id);
      writeAll(next);
      return delay({ success: next.length < questions.length });
    }
  };
})();
