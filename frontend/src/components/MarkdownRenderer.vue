<template>
  <div class="markdown-body" v-html="renderedMarkdown"></div>
</template>

<script>
import { marked } from 'marked';

export default {
  name: 'MarkdownRenderer',
  props: {
    markdownText: {
      type: String,
      default: '',
    },
  },
  computed: {
    renderedMarkdown() {
      if (!this.markdownText) {
        return '<p style="color: #909399;">暂无AI审查建议。</p>';
      }
      // Configure marked to handle line breaks properly
      marked.setOptions({
        breaks: true,
      });
      return marked.parse(this.markdownText);
    },
  },
};
</script>

<style scoped>
.markdown-body {
  padding: 15px;
  border: 1px solid #e4e7ed;
  border-radius: 4px;
  background-color: #fff;
  line-height: 1.7;
  height: 440px; /* Same height as the textarea */
  overflow-y: auto;
}

/* Basic styling for rendered markdown */
.markdown-body ::v-deep h1,
.markdown-body ::v-deep h2,
.markdown-body ::v-deep h3 {
  margin-top: 20px;
  margin-bottom: 10px;
  font-weight: 600;
  border-bottom: 1px solid #eee;
  padding-bottom: 0.3em;
}
.markdown-body ::v-deep h3 {
  font-size: 1.25em;
}
.markdown-body ::v-deep ul,
.markdown-body ::v-deep ol {
  padding-left: 2em;
}
.markdown-body ::v-deep li {
  margin-bottom: 0.5em;
}
.markdown-body ::v-deep code {
  background-color: #f6f8fa;
  border-radius: 3px;
  padding: 0.2em 0.4em;
  font-family: SFMono-Regular, Consolas, 'Liberation Mono', Menlo, Courier, monospace;
}
.markdown-body ::v-deep strong {
  color: #c0392b; /* Emphasize important text in red */
}
</style> 