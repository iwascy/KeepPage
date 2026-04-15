import { genericReaderSiteRule } from "./generic-reader";
import { sspaiReaderSiteRule } from "./sspai/archive";
import type {
  SiteArchiveOptimizationRule,
  SiteReaderRule,
} from "./types";
import { xReaderSiteRule } from "./x/archive";
import { xArchiveOptimizationRule } from "./x/optimize";
import { xiaohongshuReaderSiteRule } from "./xiaohongshu/archive";

export const readerSiteRules: SiteReaderRule[] = [
  xReaderSiteRule,
  xiaohongshuReaderSiteRule,
  genericReaderSiteRule,
  sspaiReaderSiteRule,
];

export const archiveOptimizationSiteRules: SiteArchiveOptimizationRule[] = [
  xArchiveOptimizationRule,
];
