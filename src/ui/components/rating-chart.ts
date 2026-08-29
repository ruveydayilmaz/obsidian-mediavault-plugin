import { RatingEvolutionPoint } from "../../models/review";
import { i18n, t } from "../../i18n";

export function renderRatingEvolutionChart(
  container: HTMLElement,
  points: RatingEvolutionPoint[],
): void {
  container.empty();

  const rated = points.filter(
    (p) => p.rating !== null,
  ) as (RatingEvolutionPoint & { rating: number })[];
  if (rated.length === 0) {
    container.createDiv({
      cls: "mediavault-chart-empty",
      text: t("common.noRatingsYet"),
    });
    return;
  }

  if (rated.length === 1) {
    container.createDiv({
      cls: "mediavault-chart-single",
      text: t("common.onlyOneRatedWatch", { rating: rated[0].rating.toFixed(1) }),
    });
    return;
  }

  const width = 460;
  const height = 140;
  const padding = 28;

  const maxRating = Math.max(10, ...rated.map((p) => p.rating));
  const minRating = Math.min(0, ...rated.map((p) => p.rating));

  const xStep = (width - padding * 2) / (rated.length - 1);
  const yFor = (rating: number) =>
    height -
    padding -
    ((rating - minRating) / (maxRating - minRating || 1)) *
      (height - padding * 2);
  const xFor = (i: number) => padding + i * xStep;

  const svgNs = "http://www.w3.org/2000/svg";
  const svg = document.createElementNS(svgNs, "svg");
  svg.setAttribute("viewBox", `0 0 ${width} ${height}`);
  svg.addClass("mediavault-rating-chart");

  const baseline = document.createElementNS(svgNs, "line");
  baseline.setAttribute("x1", String(padding));
  baseline.setAttribute("x2", String(width - padding));
  baseline.setAttribute("y1", String(height - padding));
  baseline.setAttribute("y2", String(height - padding));
  baseline.setAttribute("class", "mediavault-chart-axis");
  svg.appendChild(baseline);

  const pathData = rated
    .map((p, i) => `${i === 0 ? "M" : "L"} ${xFor(i)} ${yFor(p.rating)}`)
    .join(" ");
  const path = document.createElementNS(svgNs, "path");
  path.setAttribute("d", pathData);
  path.setAttribute("class", "mediavault-chart-line");
  svg.appendChild(path);

  rated.forEach((p, i) => {
    const cx = xFor(i);
    const cy = yFor(p.rating);

    const circle = document.createElementNS(svgNs, "circle");
    circle.setAttribute("cx", String(cx));
    circle.setAttribute("cy", String(cy));
    circle.setAttribute("r", "4");
    circle.setAttribute("class", "mediavault-chart-point");
    svg.appendChild(circle);

    const label = document.createElementNS(svgNs, "text");
    label.setAttribute("x", String(cx));
    label.setAttribute("y", String(cy - 10));
    label.setAttribute("text-anchor", "middle");
    label.setAttribute("class", "mediavault-chart-label");
    label.textContent = p.rating.toFixed(1);
    svg.appendChild(label);

    const watchLabel = document.createElementNS(svgNs, "text");
    watchLabel.setAttribute("x", String(cx));
    watchLabel.setAttribute("y", String(height - padding + 16));
    watchLabel.setAttribute("text-anchor", "middle");
    watchLabel.setAttribute("class", "mediavault-chart-watch-label");
    watchLabel.textContent =
      i18n.getLocale() === "en"
        ? p.rewatchNumber === 0
          ? "1st"
          : ordinal(p.rewatchNumber + 1)
        : `${p.rewatchNumber + 1}.`;
    svg.appendChild(watchLabel);
  });

  container.appendChild(svg);
}

function ordinal(n: number): string {
  const s = ["th", "st", "nd", "rd"];
  const v = n % 100;
  return n + (s[(v - 20) % 10] || s[v] || s[0]);
}
