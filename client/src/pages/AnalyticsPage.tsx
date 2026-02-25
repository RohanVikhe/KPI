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
};

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

export default function AnalyticsPage() {
  const { user } = useAuth();
  const canViewTeamAnalytics = user?.role === "MANAGER" || user?.role === "ADMIN";
  const [showPersonalSection, setShowPersonalSection] = useState(!canViewTeamAnalytics);
  const [rankingQuery, setRankingQuery] = useState("");
  const [rankingPage, setRankingPage] = useState(1);
  const [selectedMemberId, setSelectedMemberId] = useState("");

  const { data: userData, isLoading: userLoading } = useQuery({
    queryKey: ["analytics", "me"],
    queryFn: () => apiFetch<{ analytics: UserAnalytics }>("/analytics/me"),
  });

  const { data: teamData, isLoading: teamLoading } = useQuery({
    queryKey: ["analytics", "team"],
    queryFn: () => apiFetch<{ analytics: TeamAnalytics }>("/analytics/team"),
    enabled: canViewTeamAnalytics,
  });

  const { data: teamMemberData, isLoading: memberLoading, error: memberError } = useQuery({
    queryKey: ["analytics", "team", "member", selectedMemberId],
    queryFn: () =>
      apiFetch<{ analytics: TeamMemberAnalytics }>(`/analytics/team/member/${selectedMemberId}`),
    enabled: canViewTeamAnalytics && Boolean(selectedMemberId),
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
  const compactMemberGoalProgress = useMemo(() => {
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

  useEffect(() => {
    setRankingPage(1);
  }, [rankingQuery]);

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
      return;
    }
    if (!selectedMemberId) {
      return;
    }
    if (!filteredRanking.some((member) => member.userId === selectedMemberId)) {
      setSelectedMemberId("");
    }
  }, [canViewTeamAnalytics, filteredRanking, selectedMemberId]);

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

      {showPersonalSection && (
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
                      <Tooltip />
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
                      <Tooltip />
                      <Line type="monotone" dataKey="value" stroke="#44d9e6" strokeWidth={3} dot={false} />
                    </LineChart>
                  </ResponsiveContainer>
                )}
              </div>
            </div>
          </div>
        </>
      )}

      {canViewTeamAnalytics && (
        <div className="panel">
          <div className="panel-header">
            <h3>{user?.role === "ADMIN" ? "Organization Analytics" : "Team Analytics"}</h3>
            <span className="panel-sub">Track performance, filter users, and drill into individual progress.</span>
          </div>
          {teamLoading ? (
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
                            <Tooltip />
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
                        <Tooltip />
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
                                <Tooltip />
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
                                <Tooltip />
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
