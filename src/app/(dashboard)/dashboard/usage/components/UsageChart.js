"use client";

import { useState, useEffect, useCallback } from "react";
import PropTypes from "prop-types";
import {
	AreaChart,
	Area,
	XAxis,
	YAxis,
	CartesianGrid,
	Tooltip,
	ResponsiveContainer,
} from "recharts";
import Card from "@/shared/components/Card";
import SegmentedControl from "@/shared/components/SegmentedControl";

const fmtTokens = (n) => {
	if (n >= 1000000) return `${(n / 1000000).toFixed(1)}M`;
	if (n >= 1000) return `${(n / 1000).toFixed(1)}K`;
	return String(n || 0);
};

const fmtCost = (n) => `$${(n || 0).toFixed(4)}`;

export default function UsageChart({ period = "7d" }) {
	const [data, setData] = useState([]);
	const [loading, setLoading] = useState(true);
	const [viewMode, setViewMode] = useState("tokens");

	const fetchData = useCallback(async () => {
		setLoading(true);
		try {
			const res = await fetch(`/api/usage/chart?period=${period}`);
			if (res.ok) {
				const json = await res.json();
				setData(json);
			}
		} catch (e) {
			console.error("Failed to fetch chart data:", e);
		} finally {
			setLoading(false);
		}
	}, [period]);

	useEffect(() => {
		fetchData();
	}, [fetchData]);

	const hasData = data.some((d) => d.tokens > 0 || d.cost > 0);

	return (
		<Card className="flex min-w-0 flex-col gap-3 p-3 sm:p-4">
			<div className="grid w-full grid-cols-2 items-center gap-1 rounded-lg border border-border bg-bg-alt p-1 sm:w-auto sm:self-start">
				<button
					onClick={() => setViewMode("tokens")}
					className={`px-3 py-1 rounded-md text-sm font-medium transition-colors ${viewMode === "tokens" ? "bg-primary text-white shadow-sm" : "text-text-muted hover:text-text-main hover:bg-bg-hover"}`}
				>
					Tokens
				</button>
				<button
					onClick={() => setViewMode("cost")}
					className={`px-3 py-1 rounded-md text-sm font-medium transition-colors ${viewMode === "cost" ? "bg-primary text-white shadow-sm" : "text-text-muted hover:text-text-main hover:bg-bg-hover"}`}
				>
					Cost
				</button>
			</div>

			{/* Chart body */}
			<div className="p-3 sm:p-4">
				{loading ? (
					<div className="flex h-48 items-center justify-center text-sm text-steel">
						Loading...
					</div>
				) : !hasData ? (
					<div className="flex h-48 items-center justify-center text-sm text-steel">
						No data for this period
					</div>
				) : (
					<ResponsiveContainer width="100%" height={220}>
						<AreaChart
							data={data}
							margin={{ top: 4, right: 8, left: 0, bottom: 0 }}
						>
							<defs>
								<linearGradient
									id="gradTokens"
									x1="0"
									y1="0"
									x2="0"
									y2="1"
								>
									<stop
										offset="5%"
										stopColor="#3daeff"
										stopOpacity={0.3}
									/>
									<stop
										offset="95%"
										stopColor="#3daeff"
										stopOpacity={0}
									/>
								</linearGradient>
								<linearGradient
									id="gradCost"
									x1="0"
									y1="0"
									x2="0"
									y2="1"
								>
									<stop
										offset="5%"
										stopColor="#0a0a0a"
										stopOpacity={0.2}
									/>
									<stop
										offset="95%"
										stopColor="#0a0a0a"
										stopOpacity={0}
									/>
								</linearGradient>
							</defs>
							<CartesianGrid
								strokeDasharray="3 3"
								strokeOpacity={0.1}
							/>
							<XAxis
								dataKey="label"
								tick={{
									fontSize: 10,
									fill: "currentColor",
									fillOpacity: 0.5,
								}}
								tickLine={false}
								axisLine={false}
								interval="preserveStartEnd"
							/>
							<YAxis
								tick={{
									fontSize: 10,
									fill: "currentColor",
									fillOpacity: 0.5,
								}}
								tickLine={false}
								axisLine={false}
								tickFormatter={
									viewMode === "tokens" ? fmtTokens : fmtCost
								}
								width={50}
							/>
							<Tooltip
								contentStyle={{
									backgroundColor: "var(--color-canvas)",
									border: "1px solid var(--color-hairline)",
									borderRadius: "12px",
									fontSize: "12px",
									boxShadow: "0 4px 12px rgba(0,0,0,0.06)",
								}}
								formatter={(value, name) =>
									name === "tokens"
										? [fmtTokens(value), "Tokens"]
										: [fmtCost(value), "Cost"]
								}
							/>
							{viewMode === "tokens" ? (
								<Area
									type="monotone"
									dataKey="tokens"
									stroke="#3daeff"
									strokeWidth={2}
									fill="url(#gradTokens)"
									dot={false}
									activeDot={{ r: 4 }}
								/>
							) : (
								<Area
									type="monotone"
									dataKey="cost"
									stroke="#0a0a0a"
									strokeWidth={2}
									fill="url(#gradCost)"
									dot={false}
									activeDot={{ r: 4 }}
								/>
							)}
						</AreaChart>
					</ResponsiveContainer>
				)}
			</div>
		</Card>
	);
}

UsageChart.propTypes = {
	period: PropTypes.string,
};
