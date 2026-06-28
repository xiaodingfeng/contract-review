<template>
  <div class="evidence-card border border-gray-200 rounded-lg p-4 bg-white">
    <!-- 顶部:证据完整度标签 + 标题 -->
    <div class="flex items-center justify-between mb-4">
      <h3 v-if="title" class="text-base font-semibold text-gray-800 m-0">{{ title }}</h3>
      <span v-else></span>
      <el-tag :type="completenessTagType(evidence.evidence_completeness)" size="default">
        {{ completenessLabel(evidence.evidence_completeness) }}
      </el-tag>
    </div>

    <!-- 三栏布局 -->
    <div class="grid grid-cols-1 md:grid-cols-3 gap-4">
      <!-- 左栏:合同原文 -->
      <div class="border border-gray-100 rounded p-3 bg-gray-50">
        <div class="text-sm font-semibold text-gray-700 mb-2">合同原文</div>
        <template v-if="evidence.contract_anchor">
          <p class="text-sm text-gray-600 leading-relaxed mb-3">
            {{ truncate(evidence.contract_anchor.text, 200) }}
          </p>
          <el-button type="primary" size="small" @click="handleLocate">定位到合同</el-button>
        </template>
        <p v-else class="text-sm text-gray-400 italic">未定位到合同原文</p>
      </div>

      <!-- 中栏:关联法条 -->
      <div class="border border-gray-100 rounded p-3 bg-gray-50">
        <div class="text-sm font-semibold text-gray-700 mb-2">关联法条</div>
        <template v-if="legalRefs.length">
          <div
            v-for="(ref, index) in legalRefs"
            :key="index"
            class="border-b border-gray-200 last:border-b-0 pb-2 mb-2 last:pb-0 last:mb-0"
          >
            <div class="flex items-center justify-between mb-1">
              <span class="text-sm font-medium text-gray-800">
                {{ ref.law_name }} {{ ref.clause_id }}
              </span>
              <el-tag :type="lawStatusTagType(ref.law_status)" size="small">
                {{ ref.law_status }}
              </el-tag>
            </div>
            <p class="text-xs text-gray-500 leading-relaxed mb-2">
              {{ truncate(ref.content, 100) }}
            </p>
            <el-button type="primary" link size="small" @click="handleViewLaw(ref)">查看</el-button>
          </div>
        </template>
        <p v-else class="text-sm text-gray-400 italic">未关联法条</p>
      </div>

      <!-- 右栏:证据说明 -->
      <div class="border border-gray-100 rounded p-3 bg-gray-50">
        <div class="text-sm font-semibold text-gray-700 mb-2">证据说明</div>
        <p class="text-sm text-gray-600 leading-relaxed">
          {{ completenessDescription(evidence.evidence_completeness) }}
        </p>
      </div>
    </div>
  </div>
</template>

<script>
import { ElTag, ElButton } from 'element-plus';

export default {
  name: 'EvidenceCard',
  components: { ElTag, ElButton },
  props: {
    evidence: {
      type: Object,
      default: () => ({}),
    },
    title: {
      type: String,
      default: '',
    },
  },
  emits: ['locate-contract', 'view-law'],
  setup(props, { emit }) {
    const truncate = (text, max) => {
      if (!text) return '';
      return text.length > max ? text.slice(0, max) + '...' : text;
    };

    const completenessTagType = (level) => ({
      full: 'success',
      partial: 'warning',
      weak: 'danger',
    }[level] || 'info');

    const completenessLabel = (level) => ({
      full: '证据完整',
      partial: '证据部分',
      weak: '证据较弱',
    }[level] || '未知');

    const completenessDescription = (level) => ({
      full: 'AI 结论有合同原文和法条双重支撑',
      partial: 'AI 结论有部分证据支撑,建议人工复核',
      weak: 'AI 结论证据较弱,请谨慎参考',
    }[level] || '暂无证据说明');

    const lawStatusTagType = (status) => ({
      '现行': 'success',
      '已修订': 'warning',
      '已废止': 'danger',
    }[status] || 'info');

    const handleLocate = () => {
      if (props.evidence?.contract_anchor) {
        emit('locate-contract', props.evidence.contract_anchor);
      }
    };

    const handleViewLaw = (ref) => {
      emit('view-law', ref);
    };

    return {
      truncate,
      completenessTagType,
      completenessLabel,
      completenessDescription,
      lawStatusTagType,
      handleLocate,
      handleViewLaw,
    };
  },
  computed: {
    legalRefs() {
      return this.evidence?.legal_refs || [];
    },
  },
};
</script>
