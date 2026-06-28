<template>
  <div class="table-wrap">
    <table class="record-table">
      <thead>
        <tr>
          <th>文件</th>
          <th>合同类型</th>
          <th>立场</th>
          <th>风险</th>
          <th>时间</th>
          <th>状态</th>
          <th>操作</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="item in items" :key="`${item.record_type}-${item.id}`">
          <td class="file-cell" :title="item.original_filename">
            <span v-if="item.record_type === 'group'" class="record-type">多合同</span>
            {{ item.original_filename }}
          </td>
          <td class="type-cell">{{ item.contract_type || '—' }}</td>
          <td class="perspective-cell">{{ item.perspective || '—' }}</td>
          <td class="risk-cell">
            <span v-if="item.risk_count > 0" class="risk-pill">{{ item.risk_count }}</span>
            <span v-else>—</span>
          </td>
          <td>{{ formatDate(item.created_at) }}</td>
          <td><span :class="['status-pill', item.status]">{{ statusText(item.status) }}</span></td>
          <td>
            <div class="row-actions">
              <button class="text-button" @click="$emit('view', item)">查看</button>
              <el-popconfirm title="确认删除这份审查记录？" @confirm="$emit('delete', item)">
                <template #reference>
                  <button class="text-button danger">删除</button>
                </template>
              </el-popconfirm>
            </div>
          </td>
        </tr>
      </tbody>
    </table>
    <div class="pager">
      <button :disabled="page === 1" @click="$emit('update:page', page - 1)">上一页</button>
      <span>第 {{ page }} / {{ totalPages }} 页</span>
      <button :disabled="page === totalPages" @click="$emit('update:page', page + 1)">下一页</button>
    </div>
  </div>
</template>

<script>
import { ElPopconfirm } from 'element-plus';
import { formatDate, statusText } from '../composables/useHomeHistory';

export default {
  name: 'HistoryTable',
  components: { ElPopconfirm },
  props: {
    items: { type: Array, default: () => [] },
    page: { type: Number, default: 1 },
    totalPages: { type: Number, default: 1 },
  },
  emits: ['view', 'delete', 'update:page'],
  setup() {
    return { formatDate, statusText };
  },
};
</script>

<style scoped>
.table-wrap {
  min-height: 0;
}

.record-table {
  width: 100%;
  border-collapse: collapse;
  table-layout: fixed;
  overflow: hidden;
  border-radius: 8px;
  box-shadow: inset 0 0 0 1px #e5e5e5;
}

.record-table th,
.record-table td {
  height: 42px;
  padding: 8px 10px;
  border-bottom: 1px solid #eeeeee;
  text-align: left;
  vertical-align: middle;
  font-size: 12px;
}

.record-table th {
  color: #666666;
  font-weight: 800;
  background: #fafafa;
}

.file-cell {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-weight: 700;
}

.record-type {
  display: inline-flex;
  margin-right: 6px;
  border-radius: 8px;
  background: #e0f2fe;
  color: #075985;
  padding: 3px 6px;
  font-size: 11px;
  font-weight: 800;
}

.status-pill {
  display: inline-flex;
  border-radius: 999px;
  padding: 4px 8px;
  background: #f5f5f5;
  color: #333333;
  font-size: 12px;
  font-weight: 800;
  white-space: nowrap;
}

.status-pill.Reviewed {
  background: #dcfce7;
  color: #166534;
}

.status-pill.Uploaded,
.status-pill.PreAnalyzed {
  background: #dbeafe;
  color: #1d4ed8;
}

.type-cell,
.perspective-cell {
  color: #666;
  font-size: 12px;
  white-space: nowrap;
}

.risk-cell {
  text-align: center;
}

.risk-pill {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-width: 22px;
  height: 22px;
  padding: 0 6px;
  border-radius: 999px;
  background: #fee2e2;
  color: #b91c1c;
  font-size: 12px;
  font-weight: 700;
}

.row-actions,
.pager {
  display: flex;
  align-items: center;
  gap: 7px;
}

.text-button,
.pager button {
  background: #ffffff;
  color: #111111;
  padding: 6px 8px;
  box-shadow: inset 0 0 0 1px #e5e5e5;
  border: 0;
  border-radius: 8px;
  font-weight: 800;
  cursor: pointer;
}

button:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}

.text-button.danger {
  color: #ef4444;
}

.pager {
  justify-content: flex-end;
  margin-top: 9px;
  color: #666666;
  font-size: 12px;
}
</style>
