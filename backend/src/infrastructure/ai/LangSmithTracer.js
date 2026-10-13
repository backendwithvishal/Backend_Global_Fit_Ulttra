/**
 * Global-Fi Ultra - LangSmith Observability & Evaluation Tracer
 * 
 * Production tracing integration for Agentic RAG workflows:
 * 1. Traces query understanding, planning, dense & sparse search, RRF fusion, and synthesis
 * 2. Asynchronous, non-blocking telemetry (never slows down user requests)
 * 3. Passive no-op when LANGSMITH_ENABLED=false or apiKey is omitted
 * 4. Zero secret or authorization header logging
 * 
 * @module infrastructure/ai/LangSmithTracer
 */

import axios from 'axios';
import { v4 as uuidv4 } from 'uuid';
import { logger } from '../../config/logger.js';

export class LangSmithTracer {
  constructor({
    apiKey = '',
    project = 'globalfi-ultra-rag',
    endpoint = 'https://api.smith.langchain.com',
    enabled = false,
  } = {}) {
    this.apiKey = apiKey || '';
    this.project = project || 'globalfi-ultra-rag';
    this.endpoint = endpoint || 'https://api.smith.langchain.com';
    this.enabled = !!(enabled && this.apiKey);
    this.logger = logger || console;

    if (this.enabled) {
      this.logger.info(`LangSmith observability active (Project: ${this.project})`);
    } else {
      this.logger.debug('LangSmith observability disabled: Operating in local evaluation mode');
    }
  }

  /**
   * Starts a new trace span asynchronously.
   * @param {object} params
   * @returns {string} runId
   */
  startRun({ name = 'RAG_Operation', runType = 'chain', inputs = {}, parentRunId = null, metadata = {} } = {}) {
    const runId = uuidv4();
    if (!this.enabled) return runId;

    // Asynchronously record run creation
    const payload = {
      id: runId,
      name,
      run_type: runType,
      inputs,
      parent_run_id: parentRunId,
      session_name: this.project,
      start_time: new Date().toISOString(),
      extra: {
        metadata: {
          service: 'Global-Fi Ultra',
          ...metadata,
        },
      },
    };

    this._sendAsync('post', `${this.endpoint}/runs`, payload);
    return runId;
  }

  /**
   * Completes a trace span asynchronously.
   * @param {string} runId
   * @param {object} params
   */
  endRun(runId, { outputs = {}, error = null } = {}) {
    if (!this.enabled || !runId) return;

    const payload = {
      end_time: new Date().toISOString(),
      outputs,
      error: error ? String(error) : undefined,
    };

    this._sendAsync('patch', `${this.endpoint}/runs/${runId}`, payload);
  }

  /**
   * Records a complete end-to-end Agentic RAG query trace asynchronously.
   */
  traceRAGExecution({
    requestId,
    question,
    classification,
    plan,
    retrievalCount,
    confidence,
    citationsCount,
    latencyMs,
    cached = false,
  }) {
    if (!this.enabled) return;

    const runId = this.startRun({
      name: 'Agentic_Financial_RAG_Query',
      runType: 'chain',
      inputs: { question, classification },
      metadata: { requestId, cached, confidence },
    });

    this.endRun(runId, {
      outputs: {
        plan,
        retrievalCount,
        citationsCount,
        confidence,
        latencyMs,
      },
    });
  }

  /**
   * Safe asynchronous HTTP transmission.
   */
  _sendAsync(method, url, data) {
    Promise.resolve().then(async () => {
      try {
        await axios({
          method,
          url,
          data,
          headers: {
            'x-api-key': this.apiKey,
            'Content-Type': 'application/json',
          },
          timeout: 5000,
        });
      } catch (err) {
        this.logger.debug(`LangSmith trace export note: ${err.message}`);
      }
    });
  }
}

export default LangSmithTracer;
