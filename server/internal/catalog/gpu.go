package catalog

import (
	"strings"
	"unicode"
)

// GPU 镜像名称/描述中的短语关键词（驱动、CUDA、深度学习 AMI 等）。
var gpuImagePhrases = []string{
	"nvidia", "cuda", "tesla", "vgpu", "grid", "gpu", "rtx",
	"deep learning", "deeplearning", "pytorch", "tensorflow",
}

// GPU 型号短码：按 token 精确匹配，避免 t4 命中 t4g、p4 命中无关字符串。
var gpuImageModels = []string{
	"a100", "a10g", "a10", "a30", "a40", "a800",
	"h100", "h200", "h20", "l40s", "l40", "l20",
	"t4", "v100", "p100", "p40", "p4",
}

// LooksLikeGPUImage 根据名称/描述判断是否为 GPU 相关镜像（驱动、CUDA、深度学习 AMI 等）。
func LooksLikeGPUImage(parts ...string) bool {
	text := strings.ToLower(strings.Join(parts, " "))
	if text == "" {
		return false
	}
	for _, kw := range gpuImagePhrases {
		if strings.Contains(text, kw) {
			return true
		}
	}
	for _, tok := range strings.FieldsFunc(text, func(r rune) bool {
		return !unicode.IsLetter(r) && !unicode.IsDigit(r)
	}) {
		for _, m := range gpuImageModels {
			if tok == m {
				return true
			}
		}
	}
	return false
}
