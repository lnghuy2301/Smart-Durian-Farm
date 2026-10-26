const labels: Record<string, string> = {
  anthracnose_disease: 'Bệnh thán thư', canker_disease: 'Bệnh loét', fruit_rot: 'Thối quả',
  mealybug_infestation: 'Rệp sáp', pink_disease: 'Bệnh nấm hồng', sooty_mold: 'Bệnh bồ hóng',
  stem_blight: 'Bệnh khô thân', 'stem_cracking_ gummosis': 'Nứt thân, chảy gôm',
  thrips_disease: 'Bọ trĩ', yellow_leaf: 'Vàng lá',
};
export const labelVi = (label: string) => labels[label] ?? label;
export const interpretation = { kind: 'classification_suggestions',
  message: 'Top 3 gợi ý phân loại từ mô hình, không phải kết luận bệnh chắc chắn. Mô hình hiện chưa có lớp khỏe mạnh hoặc ảnh ngoài phạm vi.',
  automatic_treatment: false } as const;
