import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { apiFetch } from "../lib/api.ts";
import { useAuth } from "../lib/auth.tsx";

const TEAM_RANKING_PAGE_SIZE = 8;
const GOAL_COLORS = ["#f29d38", "#44d9e6", "#7c8cff", "#f468a5", "#6bf0a1"];
const IMPROVEMENT_MAX_PROGRESS = 59.999;

type UserAnalytics = {
  points: { date: string; score: number }[];
  rollingAverage: { date: string; value: number }[];
  summary: { total: number; lastScore: number; delta: number };
};

type TeamAnalytics = {
  ranking: { userId: string; name: string; averageScore: number; submissions: number }[];
  trend: { date: string; averageScore: number }[];
  summary: { totalEmployees: number; averageScore: number };
};

type TeamMemberAnalytics = UserAnalytics & {
  user: { id: string; name: string; email: string; role: "ADMIN" | "MANAGER" | "EMPLOYEE" };
  goalProgress: {
    goalId: string;
    key: string;
    name: string;
    averageScore: number;
    submissions: number;
    order: number;
  }[];
  goalMetricProgress: {
    goalId: string;
    key: string;
    name: string;
    order: number;
    metrics: {
      metricId: string;
      key: string;
      label: string;
      type: "NUMBER" | "PERCENT" | "CURRENCY";
      averageValue: number;
      submissions: number;
      order: number;
    }[];
  }[];
};

type GoalProgressView = TeamMemberAnalytics["goalProgress"][number] & { progress: number };
type GoalMetricProgressView = TeamMemberAnalytics["goalMetricProgress"][number];

function shortenLabel(value: string, max = 14) {
  if (value.length <= max) return value;
  return `${value.slice(0, max - 1)}...`;
}

function normalizeProgress(score: number) {
  if (!Number.isFinite(score)) return 0;
  if (score >= 0 && score <= 1) return Math.min(100, Math.max(0, score * 100));
  if (score > 1 && score <= 5) return Math.min(100, Math.max(0, (score / 5) * 100));
  return Math.min(100, Math.max(0, score));
}

function formatChartValue(value: unknown) {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value.toFixed(2);
  }
  if (typeof value === "string") {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) {
      return parsed.toFixed(2);
    }
    return value;
  }
  return String(value ?? "");
}

function buildAnalyticsDateQuery(fromDate: string, toDate: string) {
  const params = new URLSearchParams();
  if (fromDate) {
    params.set("from", fromDate);
  }
  if (toDate) {
    params.set("to", toDate);
  }
  const query = params.toString();
  return query ? `?${query}` : "";
}

function goalPerformanceBand(progress: number) {
  if (progress >= 80) return "Strong";
  if (progress >= 60) return "Healthy";
  if (progress >= 40) return "Needs Attention";
  return "Critical";
}

function formatMetricAverage(value: number, type: "NUMBER" | "PERCENT" | "CURRENCY") {
  if (!Number.isFinite(value)) return "--";
  if (type === "PERCENT") return `${value.toFixed(2)}%`;
  if (type === "CURRENCY") {
    return new Intl.NumberFormat(undefined, {
      style: "currency",
      currency: "USD",
      maximumFractionDigits: 2,
    }).format(value);
  }
  return value.toFixed(2);
}

export default function AnalyticsPage() {
  const { user } = useAuth();
  const canViewTeamAnalytics = user?.role === "MANAGER" || user?.role === "ADMIN";
  const [showPersonalSection, setShowPersonalSection] = useState(!canViewTeamAnalytics);
  const [fromDate, setFromDate] = useState("");
  const [toDate, setToDate] = useState("");
  const [rankingQuery, setRankingQuery] = useState("");
  const [rankingPage, setRankingPage] = useState(1);
  const [selectedMemberId, setSelectedMemberId] = useState("");
  const [selectedMetricGoalId, setSelectedMetricGoalId] = useState("");
  const isDateRangeInvalid = Boolean(fromDate && toDate && fromDate > toDate);
  const analyticsDateQuery = useMemo(() => buildAnalyticsDateQuery(fromDate, toDate), [fromDate, toDate]);
  const activeDateRangeLabel = useMemo(() => {
    if (!fromDate && !toDate) {
      return "All time";
    }
    return `${fromDate || "..."} to ${toDate || "..."}`;
  }, [fromDate, toDate]);

  const { data: userData, isLoading: userLoading } = useQuery({
    queryKey: ["analytics", "me", fromDate, toDate],
    queryFn: () => apiFetch<{ analytics: UserAnalytics }>(`/analytics/me${analyticsDateQuery}`),
    enabled: !isDateRangeInvalid,
  });

  const { data: teamData, isLoading: teamLoading } = useQuery({
    queryKey: ["analytics", "team", fromDate, toDate],
    queryFn: () => apiFetch<{ analytics: TeamAnalytics }>(`/analytics/team${analyticsDateQuery}`),
    enabled: canViewTeamAnalytics && !isDateRangeInvalid,
  });

  const { data: teamMemberData, isLoading: memberLoading, error: memberError } = useQuery({
    queryKey: ["analytics", "team", "member", selectedMemberId, fromDate, toDate],
    queryFn: () =>
      apiFetch<{ analytics: TeamMemberAnalytics }>(`/analytics/team/member/${selectedMemberId}${analyticsDateQuery}`),
    enabled: canViewTeamAnalytics && Boolean(selectedMemberId) && !isDateRangeInvalid,
  });

  const userAnalytics = userData?.analytics;
  const teamAnalytics = teamData?.analytics;
  const teamMemberAnalytics = teamMemberData?.analytics;

  const filteredRanking = useMemo(() => {
    const allRanking = teamAnalytics?.ranking ?? [];
    const search = rankingQuery.trim().toLowerCase();
    if (!search) {
      return allRanking;
    }
    return allRanking.filter((member) => member.name.toLowerCase().includes(search));
  }, [teamAnalytics?.ranking, rankingQuery]);

  const totalRankingPages = Math.max(1, Math.ceil(filteredRanking.length / TEAM_RANKING_PAGE_SIZE));
  const currentRankingPage = Math.min(rankingPage, totalRankingPages);
  const rankingPageStart = (currentRankingPage - 1) * TEAM_RANKING_PAGE_SIZE;
  const visibleRanking = useMemo(
    () => filteredRanking.slice(rankingPageStart, rankingPageStart + TEAM_RANKING_PAGE_SIZE),
    [filteredRanking, rankingPageStart]
  );
  const rankingChartHeight = useMemo(() => {
    const rows = Math.max(visibleRanking.length, 1);
    return Math.min(380, Math.max(190, rows * 40 + 88));
  }, [visibleRanking.length]);
  const rankingStart = filteredRanking.length === 0 ? 0 : rankingPageStart + 1;
  const rankingEnd = Math.min(rankingPageStart + TEAM_RANKING_PAGE_SIZE, filteredRanking.length);
  const teamTrendChartHeight = useMemo(() => {
    const points = teamAnalytics?.trend.length ?? 0;
    if (points <= 3) return 210;
    if (points <= 8) return 240;
    return 280;
  }, [teamAnalytics?.trend.length]);
  const memberGoalProgress = teamMemberAnalytics?.goalProgress ?? [];
  const memberGoalMetricProgress = teamMemberAnalytics?.goalMetricProgress ?? [];
  const compactMemberGoalProgress = useMemo<GoalProgressView[]>(() => {
    return memberGoalProgress
      .map((goal) => ({
        ...goal,
        progress: normalizeProgress(goal.averageScore),
      }))
      .sort((a, b) => {
        if (a.order !== b.order) return a.order - b.order;
        return a.name.localeCompare(b.name);
      });
  }, [memberGoalProgress]);
  const showGoalProgressSection = compactMemberGoalProgress.length > 0 && compactMemberGoalProgress.length <= 6;
  const memberGoalOverallProgress = useMemo(() => {
    if (!showGoalProgressSection) return null;
    const total = compactMemberGoalProgress.reduce((sum, goal) => sum + goal.progress, 0);
    return compactMemberGoalProgress.length > 0 ? total / compactMemberGoalProgress.length : 0;
  }, [compactMemberGoalProgress, showGoalProgressSection]);
  const topGoalStrengths = useMemo(
    () =>
      compactMemberGoalProgress
        .filter((goal) => goal.progress > IMPROVEMENT_MAX_PROGRESS)
        .slice()
        .sort((a, b) => b.progress - a.progress)
        .slice(),
    [compactMemberGoalProgress]
  );
  const focusGoalAreas = useMemo(
    () =>
      compactMemberGoalProgress
        .slice()
        .filter((goal) => goal.progress <= IMPROVEMENT_MAX_PROGRESS)
        .sort((a, b) => {
          if (a.progress !== b.progress) return a.progress - b.progress;
          return a.averageScore - b.averageScore;
        }),
    [compactMemberGoalProgress]
  );
  const metricGoalProgress = useMemo<GoalMetricProgressView[]>(() => {
    return memberGoalMetricProgress
      .filter((goal) => goal.metrics.length > 0)
      .slice()
      .sort((a, b) => {
        if (a.order !== b.order) return a.order - b.order;
        return a.name.localeCompare(b.name);
      });
  }, [memberGoalMetricProgress]);
  const selectedMetricGoal = useMemo(() => {
    if (metricGoalProgress.length === 0) return null;
    return metricGoalProgress.find((goal) => goal.goalId === selectedMetricGoalId) ?? metricGoalProgress[0];
  }, [metricGoalProgress, selectedMetricGoalId]);

  useEffect(() => {
    setRankingPage(1);
  }, [rankingQuery, fromDate, toDate]);

  useEffect(() => {
    if (rankingPage > totalRankingPages) {
      setRankingPage(totalRankingPages);
    }
  }, [rankingPage, totalRankingPages]);

  useEffect(() => {
    setShowPersonalSection(!canViewTeamAnalytics);
  }, [canViewTeamAnalytics]);

  useEffect(() => {
    if (!canViewTeamAnalytics) {
      setSelectedMemberId("");
      setSelectedMetricGoalId("");
      return;
    }
    if (!selectedMemberId) {
      setSelectedMetricGoalId("");
      return;
    }
    if (!filteredRanking.some((member) => member.userId === selectedMemberId)) {
      setSelectedMemberId("");
      setSelectedMetricGoalId("");
    }
  }, [canViewTeamAnalytics, filteredRanking, selectedMemberId]);

  useEffect(() => {
    if (metricGoalProgress.length === 0) {
      if (selectedMetricGoalId) {
        setSelectedMetricGoalId("");
      }
      return;
    }
    if (!metricGoalProgress.some((goal) => goal.goalId === selectedMetricGoalId)) {
      setSelectedMetricGoalId(metricGoalProgress[0].goalId);
    }
  }, [metricGoalProgress, selectedMetricGoalId]);

  return (
    <div className="page">
      {canViewTeamAnalytics && (
        <div className="analytics-toggle-row">
          <button
            type="button"
            className="btn btn-ghost"
            onClick={() => setShowPersonalSection((current) => !current)}
          >
            {showPersonalSection ? "Hide My Analytics" : "Show My Analytics"}
          </button>
        </div>
      )}

      <div className="panel analytics-date-panel">
        <div className="panel-header">
          <h3>Analytics Date Range</h3>
          <span className="panel-sub">Applies to personal, team, and focused-user insights</span>
        </div>
        <div className="form-grid team-filter-grid">
          <label className="form-field">
            <span>From</span>
            <input
              type="date"
              value={fromDate}
              max={toDate || undefined}
              onChange={(event) => setFromDate(event.target.value)}
            />
          </label>
          <label className="form-field">
            <span>To</span>
            <input
              type="date"
              value={toDate}
              min={fromDate || undefined}
              onChange={(event) => setToDate(event.target.value)}
            />
          </label>
        </div>
        <div className="table-actions">
          <span className="panel-sub">Active range: {activeDateRangeLabel}</span>
          <button
            type="button"
            className="btn btn-ghost"
            onClick={() => {
              setFromDate("");
              setToDate("");
            }}
          >
            Reset range
          </button>
        </div>
        {isDateRangeInvalid && <div className="form-error">From date must be before or equal to To date.</div>}
      </div>

      {showPersonalSection &&
        (isDateRangeInvalid ? (
          <div className="panel empty-state">Select a valid date range to load personal analytics.</div>
        ) : (
          <>
          <div className="stats-grid">
            <div className="stat-card">
              <div className="stat-label">Latest KPI</div>
              <div className="stat-value">{userAnalytics?.summary.lastScore.toFixed(2) ?? "0.00"}</div>
              <div className="stat-sub">Most recent performance score</div>
            </div>
            <div className="stat-card">
              <div className="stat-label">Delta</div>
              <div className="stat-value">
                {userAnalytics ? (userAnalytics.summary.delta >= 0 ? "+" : "") : ""}
                {userAnalytics?.summary.delta.toFixed(2) ?? "0.00"}
              </div>
              <div className="stat-sub">Change vs previous period</div>
            </div>
            <div className="stat-card">
              <div className="stat-label">Total Entries</div>
              <div className="stat-value">{userAnalytics?.summary.total ?? 0}</div>
              <div className="stat-sub">Submissions tracked</div>
            </div>
          </div>

          <div className="chart-grid">
            <div className="panel chart-card">
              <div className="panel-header">
                <h3>Personal KPI Trend</h3>
                <span className="panel-sub">Rolling average vs raw score</span>
              </div>
              <div className="chart">
                {userLoading ? (
                  <div className="empty-state">Loading analytics...</div>
                ) : (
                  <ResponsiveContainer width="100%" height={260}>
                    <AreaChart data={userAnalytics?.points ?? []}>
                      <XAxis dataKey="date" tickLine={false} axisLine={false} minTickGap={24} />
                      <YAxis tickLine={false} axisLine={false} />
                      <Tooltip formatter={(value) => formatChartValue(value)} />
                      <Area type="monotone" dataKey="score" stroke="#f29d38" fill="rgba(242, 157, 56, 0.25)" />
                      <Line
                        type="monotone"
                        dataKey="score"
                        stroke="#f29d38"
                        strokeWidth={2}
                        dot={false}
                      />
                    </AreaChart>
                  </ResponsiveContainer>
                )}
              </div>
            </div>

            <div className="panel chart-card">
              <div className="panel-header">
                <h3>Rolling Average</h3>
                <span className="panel-sub">3-period smoothing</span>
              </div>
              <div className="chart">
                {userLoading ? (
                  <div className="empty-state">Loading analytics...</div>
                ) : (
                  <ResponsiveContainer width="100%" height={260}>
                    <LineChart data={userAnalytics?.rollingAverage ?? []}>
                      <XAxis dataKey="date" tickLine={false} axisLine={false} minTickGap={24} />
                      <YAxis tickLine={false} axisLine={false} />
                      <Tooltip formatter={(value) => formatChartValue(value)} />
                      <Line type="monotone" dataKey="value" stroke="#44d9e6" strokeWidth={3} dot={false} />
                    </LineChart>
                  </ResponsiveContainer>
                )}
              </div>
            </div>
          </div>
          </>
        ))}

      {canViewTeamAnalytics && (
        <div className="panel">
          <div className="panel-header">
            <h3>{user?.role === "ADMIN" ? "Organization Analytics" : "Team Analytics"}</h3>
            <span className="panel-sub">Track performance, filter users, and drill into individual progress.</span>
          </div>
          {isDateRangeInvalid ? (
            <div className="empty-state">Select a valid date range to load analytics.</div>
          ) : teamLoading ? (
            <div className="empty-state">Loading team analytics...</div>
          ) : !teamAnalytics || teamAnalytics.ranking.length === 0 ? (
            <div className="empty-state">No team analytics data available yet.</div>
          ) : (
            <div className="analytics-section">
              <div className="analytics-inline-meta">
                <span className="panel-sub">Members tracked: {teamAnalytics.summary.totalEmployees}</span>
                <span className="panel-sub">Team average: {teamAnalytics.summary.averageScore.toFixed(2)}</span>
              </div>

              <div className="analytics-filter-bar">
                <label className="form-field">
                  <span>Find member</span>
                  <input
                    value={rankingQuery}
                    onChange={(event) => setRankingQuery(event.target.value)}
                    placeholder="Search by name"
                  />
                </label>
                <label className="form-field">
                  <span>Focus user</span>
                  <select
                    value={selectedMemberId}
                    onChange={(event) => setSelectedMemberId(event.target.value)}
                    disabled={filteredRanking.length === 0}
                  >
                    <option value="">Select user</option>
                    {filteredRanking.map((member) => (
                      <option key={member.userId} value={member.userId}>
                        {member.name}
                      </option>
                    ))}
                  </select>
                </label>
              </div>

              <div className="analytics-team-grid">
                <div className="chart-card panel">
                  <div className="panel-header">
                    <h4>Ranking</h4>
                    <span className="panel-sub">
                      Showing {rankingStart}-{rankingEnd} of {filteredRanking.length} members
                    </span>
                  </div>
                  {visibleRanking.length === 0 ? (
                    <div className="empty-state">No ranking rows for this filter.</div>
                  ) : (
                    <>
                      <div className="chart">
                        <ResponsiveContainer width="100%" height={rankingChartHeight}>
                          <BarChart data={visibleRanking} layout="vertical" margin={{ left: 10, right: 10 }}>
                            <XAxis type="number" tickLine={false} axisLine={false} />
                            <YAxis
                              type="category"
                              dataKey="name"
                              width={120}
                              tickLine={false}
                              axisLine={false}
                              tickFormatter={(value) => shortenLabel(String(value), 15)}
                            />
                            <Tooltip formatter={(value) => formatChartValue(value)} />
                            <Bar dataKey="averageScore" fill="#7c8cff" radius={[0, 8, 8, 0]} />
                          </BarChart>
                        </ResponsiveContainer>
                      </div>
                      {filteredRanking.length > TEAM_RANKING_PAGE_SIZE && (
                        <div className="table-pagination">
                          <button
                            type="button"
                            className="btn btn-ghost"
                            onClick={() => setRankingPage((current) => Math.max(1, current - 1))}
                            disabled={currentRankingPage === 1}
                          >
                            Previous
                          </button>
                          <span className="panel-sub">
                              Page {currentRankingPage} of {totalRankingPages}
                            </span>
                          <button
                            type="button"
                            className="btn btn-ghost"
                            onClick={() => setRankingPage((current) => Math.min(totalRankingPages, current + 1))}
                            disabled={currentRankingPage === totalRankingPages}
                          >
                            Next
                          </button>
                        </div>
                      )}
                    </>
                  )}
                </div>

                <div className="chart-card panel">
                  <div className="panel-header">
                    <h4>Team Trend</h4>
                    <span className="panel-sub">Average KPI across all visible periods</span>
                  </div>
                  <div className="chart">
                    <ResponsiveContainer width="100%" height={teamTrendChartHeight}>
                      <LineChart data={teamAnalytics.trend}>
                        <XAxis dataKey="date" tickLine={false} axisLine={false} minTickGap={24} />
                        <YAxis tickLine={false} axisLine={false} />
                        <Tooltip formatter={(value) => formatChartValue(value)} />
                        <Line type="monotone" dataKey="averageScore" stroke="#6bf0a1" strokeWidth={3} dot={false} />
                      </LineChart>
                    </ResponsiveContainer>
                  </div>
                </div>
              </div>

              {selectedMemberId && (
                <div className="panel analytics-member-panel">
                  <div className="panel-header">
                    <h4>Focused User Progress</h4>
                    {teamMemberAnalytics?.user ? (
                      <span className="panel-sub">
                        {teamMemberAnalytics.user.name} ({teamMemberAnalytics.user.role})
                      </span>
                    ) : (
                      <span className="panel-sub">Member details</span>
                    )}
                  </div>
                  {memberLoading ? (
                    <div className="empty-state">Loading selected user progress...</div>
                  ) : memberError ? (
                    <div className="empty-state">Unable to load selected user analytics.</div>
                  ) : !teamMemberAnalytics ? (
                    <div className="empty-state">No data available for this user.</div>
                  ) : (
                    <div className="analytics-member-content">
                      <div className="table-actions">
                        <span className="panel-sub">{teamMemberAnalytics.user.email}</span>
                        <Link className="btn btn-ghost" to={`/team?userId=${encodeURIComponent(teamMemberAnalytics.user.id)}`}>
                          View submissions
                        </Link>
                      </div>
                      {showGoalProgressSection && (
                        <div className="analytics-goal-card">
                          <div className="panel-header">
                            <h4>Personal Goal Progress</h4>
                            <span className="panel-sub">Average score by goal</span>
                          </div>
                          <div className="progress-stack">
                            {memberGoalOverallProgress !== null && (
                              <div className="progress-row overall">
                                <div className="progress-label">Overall Score</div>
                                <div className="progress-bar">
                                  <div className="progress-fill" style={{ width: `${memberGoalOverallProgress}%` }} />
                                </div>
                                <div className="progress-value">{memberGoalOverallProgress.toFixed(0)}%</div>
                              </div>
                            )}
                            {compactMemberGoalProgress.map((goal, index) => (
                              <div key={goal.goalId} className="progress-row">
                                <div className="progress-label">{shortenLabel(goal.name, 26)}</div>
                                <div className="progress-bar">
                                  <div
                                    className="progress-fill"
                                    style={{
                                      width: `${goal.progress}%`,
                                      background: GOAL_COLORS[index % GOAL_COLORS.length],
                                    }}
                                  />
                                </div>
                                <div className="progress-value">{goal.progress.toFixed(0)}%</div>
                              </div>
                            ))}
                          </div>
                        </div>
                      )}
                      {compactMemberGoalProgress.length > 0 && (
                        <div className="analytics-insight-grid">
                          <div className="analytics-insight-card">
                            <div className="panel-header">
                              <h4>Top Strengths</h4>
                              <span className="panel-sub">Ranked by highest goal progress</span>
                            </div>
                            <div className="analytics-insight-list">
                              {topGoalStrengths.length === 0 ? (
                                <div className="empty-state">No strength goals in this range.</div>
                              ) : (
                                topGoalStrengths.map((goal) => (
                                  <div key={`top-${goal.goalId}`} className="analytics-insight-item">
                                    <div className="analytics-insight-title">{goal.name}</div>
                                    <div className="analytics-insight-meta">
                                      Avg {goal.averageScore.toFixed(2)} | {goal.progress.toFixed(0)}% |{" "}
                                      {goalPerformanceBand(goal.progress)}
                                    </div>
                                  </div>
                                ))
                              )}
                            </div>
                          </div>
                          <div className="analytics-insight-card">
                            <div className="panel-header">
                              <h4>Needs Improvement</h4>
                              <span className="panel-sub">Goals at or below 60% progress</span>
                            </div>
                            <div className="analytics-insight-list">
                              {focusGoalAreas.length === 0 ? (
                                <div className="empty-state">No goals need improvement in this range.</div>
                              ) : (
                                focusGoalAreas.map((goal) => (
                                  <div key={`focus-${goal.goalId}`} className="analytics-insight-item">
                                    <div className="analytics-insight-title">{goal.name}</div>
                                    <div className="analytics-insight-meta">
                                      Avg {goal.averageScore.toFixed(2)} | {goal.progress.toFixed(0)}% |{" "}
                                      {goalPerformanceBand(goal.progress)}
                                    </div>
                                  </div>
                                ))
                              )}
                            </div>
                          </div>
                        </div>
                      )}
                      {metricGoalProgress.length > 0 && (
                        <div className="analytics-goal-detail-card">
                          <div className="panel-header">
                            <h4>Child Goal Metrics</h4>
                            <span className="panel-sub">Metric-level view for the selected parent goal</span>
                          </div>
                          <div className="form-grid team-filter-grid">
                            <label className="form-field">
                              <span>Parent Goal</span>
                              <select
                                value={selectedMetricGoal?.goalId ?? ""}
                                onChange={(event) => setSelectedMetricGoalId(event.target.value)}
                              >
                                {metricGoalProgress.map((goal) => (
                                  <option key={`metric-goal-${goal.goalId}`} value={goal.goalId}>
                                    {goal.name}
                                  </option>
                                ))}
                              </select>
                            </label>
                          </div>
                          {selectedMetricGoal ? (
                            <div className="analytics-goal-detail-table">
                              <div className="analytics-goal-detail-row analytics-goal-detail-row-header">
                                <div>Child Goal</div>
                                <div>Average</div>
                                <div>Months</div>
                              </div>
                              {selectedMetricGoal.metrics.map((metric) => (
                                <div
                                  key={`metric-detail-${selectedMetricGoal.goalId}-${metric.metricId}`}
                                  className="analytics-goal-detail-row"
                                >
                                  <div title={metric.label}>{shortenLabel(metric.label, 36)}</div>
                                  <div>{formatMetricAverage(metric.averageValue, metric.type)}</div>
                                  <div>{metric.submissions}</div>
                                </div>
                              ))}
                            </div>
                          ) : (
                            <div className="empty-state">No child metrics available for this goal.</div>
                          )}
                        </div>
                      )}
                      <div className="analytics-member-stats">
                        <div className="stat-card">
                          <div className="stat-label">Latest KPI</div>
                          <div className="stat-value">{teamMemberAnalytics.summary.lastScore.toFixed(2)}</div>
                          <div className="stat-sub">Most recent score</div>
                        </div>
                        <div className="stat-card">
                          <div className="stat-label">Delta</div>
                          <div className="stat-value">
                            {teamMemberAnalytics.summary.delta >= 0 ? "+" : ""}
                            {teamMemberAnalytics.summary.delta.toFixed(2)}
                          </div>
                          <div className="stat-sub">Change vs previous period</div>
                        </div>
                        <div className="stat-card">
                          <div className="stat-label">Total Entries</div>
                          <div className="stat-value">{teamMemberAnalytics.summary.total}</div>
                          <div className="stat-sub">Submissions tracked</div>
                        </div>
                      </div>
                      <div className="chart-grid">
                        <div className="panel chart-card">
                          <div className="panel-header">
                            <h4>User Trend</h4>
                            <span className="panel-sub">Raw score timeline</span>
                          </div>
                          <div className="chart">
                            <ResponsiveContainer width="100%" height={260}>
                              <AreaChart data={teamMemberAnalytics.points}>
                                <XAxis dataKey="date" tickLine={false} axisLine={false} minTickGap={24} />
                                <YAxis tickLine={false} axisLine={false} />
                                <Tooltip formatter={(value) => formatChartValue(value)} />
                                <Area
                                  type="monotone"
                                  dataKey="score"
                                  stroke="#f29d38"
                                  fill="rgba(242, 157, 56, 0.25)"
                                />
                                <Line type="monotone" dataKey="score" stroke="#f29d38" strokeWidth={2} dot={false} />
                              </AreaChart>
                            </ResponsiveContainer>
                          </div>
                        </div>
                        <div className="panel chart-card">
                          <div className="panel-header">
                            <h4>User Rolling Average</h4>
                            <span className="panel-sub">3-period smoothing</span>
                          </div>
                          <div className="chart">
                            <ResponsiveContainer width="100%" height={260}>
                              <LineChart data={teamMemberAnalytics.rollingAverage}>
                                <XAxis dataKey="date" tickLine={false} axisLine={false} minTickGap={24} />
                                <YAxis tickLine={false} axisLine={false} />
                                <Tooltip formatter={(value) => formatChartValue(value)} />
                                <Line type="monotone" dataKey="value" stroke="#44d9e6" strokeWidth={3} dot={false} />
                              </LineChart>
                            </ResponsiveContainer>
                          </div>
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
