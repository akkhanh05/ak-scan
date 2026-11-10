/**
 * DOCX exporter for the shared document model. Pure: it builds a `docx`
 * Document that the caller packs (Blob in the browser, Buffer in tests).
 */

import {
  AlignmentType, BorderStyle, Document, HeadingLevel, HorizontalPositionRelativeFrom, ImageRun, LevelFormat,
  PageOrientation, Paragraph, ShadingType, Tab, TabStopType, Table, TableCell, TableLayoutType, TableRow, TextRun,
  TextWrappingType, VerticalAlign, VerticalPositionRelativeFrom, WidthType,
} from "docx";
import type { ISectionOptions } from "docx";
import { compactRuns } from "../document-model";
import type { DocumentBlock, ImageBlock, PageContent, ParagraphBlock, TableBlock, TextRunModel } from "../document-model";
import { MARGIN_MM, mmToPoints, sheetSize } from "../export-options";
import type { PageMargin, PageSize, WordMode } from "../export-options";
import { sanitizeDocumentText } from "../upload-security";

export interface WordExportOptions {
  pageSize: PageSize;
  margin: PageMargin;
  mode: WordMode;
  title?: string;
}

const LANGUAGE = { value: "vi-VN", eastAsia: "vi-VN", bidirectional: "vi-VN" } as const;
const twips = (points: number) => Math.round(points * 20);
const NUMBERING = "ak-numbered-list";
const BULLETS = "ak-bullet-list";

type Child = Paragraph | Table;
type SectionChildren = Child[];

function runChildren(text: string) {
  const parts = sanitizeDocumentText(text).split("\t");
  return parts.flatMap((part, index) => index === 0 ? (part ? [part] : []) : [new Tab(), ...(part ? [part] : [])]);
}

function textRuns(runs: TextRunModel[], defaults: { size?: number; bold?: boolean; color?: string }, keepSizes: boolean) {
  // "flagged" only matters for the review step; merging keeps words in one run.
  return compactRuns(runs.map((run) => ({ ...run, flagged: undefined }))).filter((run) => run.text).map((run) => new TextRun({
    children: runChildren(run.text),
    bold: run.bold ?? defaults.bold,
    italics: run.italic,
    color: run.color ?? defaults.color,
    font: run.font,
    size: keepSizes && (run.size ?? defaults.size) ? Math.round((run.size ?? defaults.size)! * 2) : defaults.size ? Math.round(defaults.size * 2) : undefined,
    language: LANGUAGE,
  }));
}

function alignment(value: ParagraphBlock["align"] | undefined) {
  if (value === "center") return AlignmentType.CENTER;
  if (value === "right") return AlignmentType.RIGHT;
  if (value === "justify") return AlignmentType.JUSTIFIED;
  return AlignmentType.LEFT;
}

/**
 * `originX/originY` is the top-left of the source content; `scale` shrinks
 * source positions/widths when the content is wider than the Word page.
 */
interface PageGeometry { contentWidth: number; marginLeft: number; marginTop: number; originX: number; originY: number; scale: number }

function pageSection(page: PageContent, options: WordExportOptions, children: SectionChildren): ISectionOptions {
  const [width, height] = options.pageSize === "fit" ? [page.width, page.height] : sheetSize(options.pageSize, page.width, page.height);
  const margin = twips(mmToPoints(MARGIN_MM[options.margin]));
  const landscape = width > height;
  return {
    properties: {
      page: {
        size: { width: twips(landscape ? height : width), height: twips(landscape ? width : height), orientation: landscape ? PageOrientation.LANDSCAPE : PageOrientation.PORTRAIT },
        margin: { top: margin, right: margin, bottom: margin, left: margin, header: 0, footer: 0, gutter: 0 },
      },
    },
    children,
  };
}

function geometry(page: PageContent, options: WordExportOptions): PageGeometry {
  const [width] = options.pageSize === "fit" ? [page.width] : sheetSize(options.pageSize, page.width, page.height);
  const margin = mmToPoints(MARGIN_MM[options.margin]);
  const content = page.blocks.length
    ? page.blocks.flatMap((block) => block.kind !== "image" && block.kind !== "table" && block.shadingBox ? [block.bbox, block.shadingBox] : [block.bbox])
    : [{ x0: 0, y0: 0, x1: page.width, y1: page.height }];
  const contentWidth = Math.max(72, width - margin * 2);
  const originX = Math.min(...content.map((box) => box.x0));
  const sourceWidth = Math.max(1, Math.max(...content.map((box) => box.x1)) - originX);
  return {
    contentWidth,
    marginLeft: margin,
    marginTop: margin,
    originX,
    originY: Math.min(...content.map((box) => box.y0)),
    scale: Math.min(1, contentWidth / sourceWidth),
  };
}

function paragraph(block: ParagraphBlock, page: PageContent, options: WordExportOptions, geo: PageGeometry, previousBottom: number | null, listInstance: number) {
  const preserve = options.mode === "preserve-layout";
  const keepSizes = page.source === "text-layer" || preserve;
  const isHeading = block.kind === "heading" || block.kind === "title";
  const defaults = {
    size: keepSizes ? block.fontSize : block.kind === "title" ? 18 : block.kind === "heading" ? (block.level === 1 ? 16 : 13) : 11,
    bold: isHeading || undefined,
  };
  const spacingBefore = preserve && previousBottom !== null ? twips(Math.max(0, block.bbox.y0 - previousBottom)) : isHeading ? 120 : 0;
  const bandPaddingLeft = block.shadingBox && block.align === "left" && block.bbox.x0 > block.shadingBox.x0 + 2
    ? twips((block.bbox.x0 - block.shadingBox.x0) * geo.scale)
    : undefined;
  const bandBorder = block.shading
    ? {
      top: { style: BorderStyle.SINGLE, size: 6, color: block.shading, space: 2 },
      bottom: { style: BorderStyle.SINGLE, size: 6, color: block.shading, space: 2 },
      left: { style: BorderStyle.SINGLE, size: 6, color: block.shading, space: 4 },
      right: { style: BorderStyle.SINGLE, size: 6, color: block.shading, space: 4 },
    }
    : undefined;
  return new Paragraph({
    heading: block.kind === "title" ? HeadingLevel.TITLE : block.kind === "heading" ? (block.level === 1 ? HeadingLevel.HEADING_1 : HeadingLevel.HEADING_2) : undefined,
    alignment: alignment(block.align),
    numbering: block.kind === "list-item" ? { reference: block.listType === "ordered" ? NUMBERING : BULLETS, level: 0, instance: listInstance } : undefined,
    tabStops: block.tabStops?.map((x) => ({ type: TabStopType.LEFT, position: twips(Math.max(0, (x - geo.originX) * geo.scale)) })),
    indent: block.shadingBox
      ? {
        left: twips(Math.max(0, (block.shadingBox.x0 - geo.originX) * geo.scale)),
        right: twips(Math.max(0, geo.contentWidth - (block.shadingBox.x1 - geo.originX) * geo.scale)),
        firstLine: bandPaddingLeft,
      }
      : preserve && block.kind !== "list-item" && block.align !== "center"
        ? { left: twips(Math.min(geo.contentWidth * .8, Math.max(0, (block.bbox.x0 - geo.originX) * geo.scale))) }
        : undefined,
    spacing: { before: spacingBefore, after: preserve ? 0 : block.shading ? 80 : isHeading ? 100 : 80, line: 260 },
    shading: block.shading ? { type: ShadingType.CLEAR, color: "auto", fill: block.shading } : undefined,
    border: bandBorder,
    children: textRuns(block.runs, defaults, keepSizes),
  });
}

function table(block: TableBlock, page: PageContent, options: WordExportOptions, geo: PageGeometry) {
  const total = block.columnWidths.reduce((sum, width) => sum + width, 0);
  const fit = Math.min(geo.scale, geo.contentWidth / Math.max(1, total));
  const widths = block.columnWidths.map((width) => Math.max(1, twips(width * fit)));
  const border = block.bordered
    ? { style: BorderStyle.SINGLE, size: 4, color: "808080" }
    : { style: BorderStyle.NONE, size: 0, color: "FFFFFF" };
  const keepSizes = page.source === "text-layer" || options.mode === "preserve-layout";
  return new Table({
    layout: TableLayoutType.FIXED,
    width: { size: widths.reduce((sum, width) => sum + width, 0), type: WidthType.DXA },
    columnWidths: widths,
    indent: options.mode === "preserve-layout" ? { size: twips(Math.max(0, (block.bbox.x0 - geo.originX) * geo.scale)), type: WidthType.DXA } : undefined,
    borders: { top: border, bottom: border, left: border, right: border, insideHorizontal: border, insideVertical: border },
    rows: block.rows.filter((row) => row.length).map((row) => new TableRow({
      children: row.map((cell) => new TableCell({
        columnSpan: cell.colSpan > 1 ? cell.colSpan : undefined,
        rowSpan: cell.rowSpan > 1 ? cell.rowSpan : undefined,
        width: { size: widths.slice(cell.column, cell.column + cell.colSpan).reduce((sum, width) => sum + width, 0), type: WidthType.DXA },
        verticalAlign: VerticalAlign.CENTER,
        shading: cell.shading ? { type: ShadingType.CLEAR, color: "auto", fill: cell.shading } : undefined,
        margins: { top: 20, bottom: 20, left: 40, right: 40 },
        children: [new Paragraph({
          alignment: alignment(cell.align),
          spacing: { before: 0, after: 0 },
          children: textRuns(cell.runs, { size: keepSizes ? undefined : 10 }, keepSizes),
        })],
      })),
    })),
  });
}

function image(block: ImageBlock, options: WordExportOptions, geo: PageGeometry, inline = false) {
  if (!block.data?.length) return null;
  const widthPt = Math.min(geo.contentWidth, (block.bbox.x1 - block.bbox.x0) * geo.scale);
  const heightPt = (block.bbox.y1 - block.bbox.y0) * widthPt / Math.max(1, block.bbox.x1 - block.bbox.x0);
  const px = (points: number) => Math.max(1, Math.round(points * 96 / 72));
  const floating = !inline && options.mode === "preserve-layout" ? {
    horizontalPosition: { relative: HorizontalPositionRelativeFrom.PAGE, offset: Math.round((geo.marginLeft + (block.bbox.x0 - geo.originX) * geo.scale) * 12700) },
    verticalPosition: { relative: VerticalPositionRelativeFrom.PAGE, offset: Math.round((geo.marginTop + (block.bbox.y0 - geo.originY) * geo.scale) * 12700) },
    wrap: { type: TextWrappingType.NONE },
    allowOverlap: true,
  } : undefined;
  return new ImageRun({ type: "png", data: block.data, transformation: { width: px(widthPt), height: px(heightPt) }, floating });
}

function sideBySideHeader(imageBlock: ImageBlock, sideBlocks: ParagraphBlock[], page: PageContent, options: WordExportOptions, geo: PageGeometry) {
  const run = image(imageBlock, options, geo, true);
  if (!run) return null;
  const textX0 = Math.min(...sideBlocks.map((block) => block.bbox.x0));
  const leftWidth = twips(Math.max(36, (textX0 - geo.originX) * geo.scale));
  const rightWidth = Math.max(72, twips(geo.contentWidth) - leftWidth);
  const none = { style: BorderStyle.NONE, size: 0, color: "FFFFFF" };
  const keepSizes = page.source === "text-layer" || options.mode === "preserve-layout";
  return new Table({
    layout: TableLayoutType.FIXED,
    width: { size: leftWidth + rightWidth, type: WidthType.DXA },
    columnWidths: [leftWidth, rightWidth],
    borders: { top: none, bottom: none, left: none, right: none, insideHorizontal: none, insideVertical: none },
    rows: [new TableRow({
      children: [
        new TableCell({
          width: { size: leftWidth, type: WidthType.DXA },
          verticalAlign: VerticalAlign.CENTER,
          margins: { top: 0, bottom: 0, left: 0, right: 80 },
          children: [new Paragraph({ spacing: { before: 0, after: 0 }, children: [run] })],
        }),
        new TableCell({
          width: { size: rightWidth, type: WidthType.DXA },
          verticalAlign: VerticalAlign.CENTER,
          margins: { top: 0, bottom: 0, left: 0, right: 0 },
          children: sideBlocks.map((block) => new Paragraph({
            alignment: alignment(block.align),
            spacing: { before: 0, after: 20, line: 230 },
            children: textRuns(block.runs, { size: keepSizes ? block.fontSize : 11, bold: block.kind === "heading" || block.kind === "title" || undefined }, keepSizes),
          })),
        }),
      ],
    })],
  });
}

/** Builds the DOCX document. Each source page becomes its own section/page. */
export function createWordDocument(pages: PageContent[], options: WordExportOptions): Document {
  let listInstance = 0;
  const sections = pages.map((page) => {
    const geo = geometry(page, options);
    const children: SectionChildren = [];
    let previousBottom: number | null = options.mode === "preserve-layout" ? geo.originY : null;
    let previousKind: DocumentBlock["kind"] | undefined;
    let previousList: ParagraphBlock["listType"];
    const floatingImages: ImageRun[] = [];
    for (let index = 0; index < page.blocks.length; index++) {
      const block = page.blocks[index];
      if (block.kind === "image") {
        // An image sitting alongside header lines (a company logo + address block)
        // is placed in a borderless two-column table so both modes stay aligned.
        const sideBlocks: ParagraphBlock[] = [];
        for (let next = index + 1; next < page.blocks.length; next++) {
          const candidate = page.blocks[next];
          if (candidate.kind === "image" || candidate.kind === "table" || candidate.shadingBox) break;
          if (candidate.bbox.x0 < block.bbox.x1 - 4 || candidate.bbox.y0 > block.bbox.y1 + 12 || candidate.bbox.y1 < block.bbox.y0 - 12) break;
          sideBlocks.push(candidate);
        }
        const paired = sideBlocks.length ? sideBySideHeader(block, sideBlocks, page, options, geo) : null;
        if (paired) {
          children.push(paired);
          children.push(new Paragraph({ spacing: { before: 0, after: 40 }, children: [] }));
          previousBottom = Math.max(block.bbox.y1, ...sideBlocks.map((item) => item.bbox.y1));
          previousKind = "table";
          index += sideBlocks.length;
          continue;
        }
        const run = image(block, options, geo);
        if (run && options.mode === "preserve-layout") floatingImages.push(run);
        else if (run) children.push(new Paragraph({ children: [run], spacing: { after: 120 } }));
        continue;
      }
      if (block.kind === "table") {
        children.push(table(block, page, options, geo));
        // Word merges adjacent tables; an empty paragraph keeps them separate.
        children.push(new Paragraph({ spacing: { before: 0, after: options.mode === "preserve-layout" ? 0 : 120 }, children: [] }));
        previousBottom = block.bbox.y1;
        previousKind = "table";
        continue;
      }
      if (block.kind === "list-item" && (previousKind !== "list-item" || previousList !== block.listType)) listInstance++;
      children.push(paragraph(block, page, options, geo, previousBottom, listInstance));
      previousBottom = block.bbox.y1;
      previousKind = block.kind;
      previousList = block.listType;
    }
    if (floatingImages.length) children.unshift(new Paragraph({ children: floatingImages, spacing: { before: 0, after: 0 } }));
    if (!children.length) children.push(new Paragraph({ children: [] }));
    return pageSection(page, options, children);
  });

  const heading = (id: string, name: string, size: number) => ({
    id, name, basedOn: "Normal", next: "Normal", quickFormat: true,
    run: { bold: true, size: size * 2, color: "000000", language: LANGUAGE },
    paragraph: { spacing: { before: 160, after: 120 }, keepNext: true },
  });
  return new Document({
    creator: "AK Scan",
    title: options.title ?? "Tài liệu chuyển đổi bởi AK Scan",
    description: "Tài liệu Word chỉnh sửa được, tạo hoàn toàn trên thiết bị bằng AK Scan.",
    styles: {
      default: { document: { run: { font: "Arial", size: 22, language: LANGUAGE }, paragraph: { spacing: { after: 100, line: 264 } } } },
      paragraphStyles: [heading("Title", "Title", 18), heading("Heading1", "Heading 1", 16), heading("Heading2", "Heading 2", 13)],
    },
    numbering: {
      config: [
        { reference: NUMBERING, levels: [{ level: 0, format: LevelFormat.DECIMAL, text: "%1.", alignment: AlignmentType.LEFT, style: { paragraph: { indent: { left: 720, hanging: 360 } } } }] },
        { reference: BULLETS, levels: [{ level: 0, format: LevelFormat.BULLET, text: "•", alignment: AlignmentType.LEFT, style: { paragraph: { indent: { left: 720, hanging: 360 } } } }] },
      ],
    },
    sections,
  });
}
