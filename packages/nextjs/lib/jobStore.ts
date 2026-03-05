// Simple in-memory job store for x402 API jobs
// In production, this would be a database. For now, jobs persist until server restart.

export interface X402Job {
  id: string;
  serviceType: string;
  description: string;
  context?: string;
  status: "queued" | "processing" | "completed" | "failed";
  result?: {
    buildPlan?: string;
    gistUrl?: string;
    report?: string;
    recommendedService?: string;
  };
  error?: string;
  priceUsd: string;
  payer?: string;
  createdAt: string;
  completedAt?: string;
}

const jobs = new Map<string, X402Job>();
let nextId = 1;

export function createJob(params: {
  serviceType: string;
  description: string;
  context?: string;
  priceUsd: string;
  payer?: string;
}): X402Job {
  const id = `x402-${nextId++}`;
  const job: X402Job = {
    id,
    serviceType: params.serviceType,
    description: params.description,
    context: params.context,
    status: "queued",
    priceUsd: params.priceUsd,
    payer: params.payer,
    createdAt: new Date().toISOString(),
  };
  jobs.set(id, job);
  return job;
}

export function getJob(id: string): X402Job | undefined {
  return jobs.get(id);
}

export function updateJob(id: string, updates: Partial<X402Job>): X402Job | undefined {
  const job = jobs.get(id);
  if (!job) return undefined;
  Object.assign(job, updates);
  return job;
}

export function listJobs(): X402Job[] {
  return Array.from(jobs.values()).sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
}
