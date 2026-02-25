import { promises as fs } from "fs";
import { AppError } from "../utils/errors.js";
import { getReportForDownload } from "../services/reportService.js";
export async function downloadReportHandler(req, res) {
    if (!req.user) {
        throw new AppError("Authorization required", 401, "AUTH_REQUIRED");
    }
    const { id } = req.params;
    const report = await getReportForDownload(id, req.user.id, req.user.role);
    try {
        await fs.access(report.filePath);
    }
    catch {
        throw new AppError("Report file missing", 404, "REPORT_MISSING");
    }
    return res.download(report.filePath, report.fileName);
}
