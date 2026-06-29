import { GoogleGenAI } from "@google/genai";
import { AppError } from "../utils/errors.js";

const aiClient = process.env.GEMINI_API_KEY
  ? new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY })
  : null;

export type RawDeliveryData = {
  headers: string[];
  rows: string[][];
};

export type MetricData = {
  label: string;
  value: number;
};

export type AiInsightsResult = {
  alerts: string[];
  narrative: string;
};

export async function generateInsights(
  metrics: MetricData[],
  rawDeliveryData: RawDeliveryData | null,
  subjectName = "the employee",
  context: { dateRange?: string; isTeamView?: boolean } = {}
): Promise<AiInsightsResult> {
  if (!aiClient) {
    throw new AppError(
      "AI Service is not configured. Please set GEMINI_API_KEY in your environment.",
      503,
      "AI_NOT_CONFIGURED"
    );
  }

  const { dateRange, isTeamView } = context;
  const metricsText =
    metrics.length > 0
      ? metrics.map((m) => `- ${m.label}: ${m.value}`).join("\n")
      : "No metric data available.";

  const hasRawData = rawDeliveryData && rawDeliveryData.rows.length > 0;
  const rawHeadersText = hasRawData ? rawDeliveryData!.headers.join(" | ") : "None provided.";
  const rawRowsText = hasRawData
    ? rawDeliveryData!.rows
        .slice(0, 50)
        .map((r) => r.join(" | "))
        .join("\n")
    : "None provided.";

  const prompt = `You are an expert ${isTeamView ? "Engineering Director" : "Performance Review Assistant"} analyzing software delivery KPI data.

Subject: ${isTeamView ? "Team Performance Executive Summary" : subjectName}
Period: ${dateRange || "Not specified"}

Your task is to:
1. Identify "Integrity Alerts": 
   - If raw delivery data is provided: Identify logical inconsistencies (e.g., tickets with Rework Count > 0 but FTR Flag = Yes).
   - If raw data is NOT provided: Identify statistical anomalies or alarming trends in the metrics themselves (e.g., 0% quality adherence or extremely high rework rates).
   - IMPORTANT: If there are truly no issues, return an empty list. NEVER complain about missing data in the alerts list.

2. Write a "Performance Narrative": 
   ${isTeamView ? `
   - This summary is for a CTO. Use a formal, executive tone.
   - Structure the response using clear sections (e.g., 🟢 OPERATIONAL OVERVIEW, ⚡ VELOCITY & EFFICIENCY, 🛡️ QUALITY & RISK).
   - Use concise, data-driven bullet points for each section.
   - Focus on business impact, ROI, and high-level technical health.
   ` : `
   - Provide a detailed, professional summary of ${subjectName}'s performance.
   - Focus on volume, quality trends, and work-type distribution.
   `}
   - Period: ${dateRange || "the selected timeframe"}.
   - Analyze the current metrics: ${metricsText.replace(/\n/g, ", ")}.
   - DO NOT mention "scores" or "points". Focus on objective delivery performance.

Respond ONLY with valid JSON. Use this exact format:
{
  "alerts": ["specific alert string 1", "specific alert string 2"],
  "narrative": "detailed professional narrative string with newlines for formatting"
}

---
KPI Metrics:
${metricsText}

---
Raw Delivery Log Sample (if available):
Headers: ${rawHeadersText}
Rows:
${rawRowsText}
`;

  try {
    const response = await aiClient.models.generateContent({
      model: "gemini-2.5-flash",
      contents: prompt,
      config: {
        responseMimeType: "application/json",
      },
    });

    const jsonText = response.text;
    if (!jsonText) {
      throw new Error("Empty response from AI model.");
    }

    const parsed = JSON.parse(jsonText);
    return {
      alerts: Array.isArray(parsed.alerts) ? (parsed.alerts as string[]) : [],
      narrative: typeof parsed.narrative === "string" ? parsed.narrative : "",
    };
  } catch (error: any) {
    if (error instanceof AppError) throw error;
    throw new AppError(
      `Failed to generate AI insights: ${error.message}`,
      500,
      "AI_GENERATION_FAILED"
    );
  }
}
