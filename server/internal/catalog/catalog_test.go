package catalog

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"reflect"
	"testing"

	"github.com/gin-gonic/gin"
)

type stubProvider struct {
	images []Item
	types  []Item
}

func (s stubProvider) Images(context.Context, string) ([]Item, error) {
	return s.images, nil
}

func (s stubProvider) InstanceTypes(context.Context, string) ([]Item, error) {
	return s.types, nil
}

func TestParseKind(t *testing.T) {
	cases := []struct {
		kind    string
		base    string
		gpuOnly bool
		ok      bool
	}{
		{"images", "images", false, true},
		{"instanceTypes", "instanceTypes", false, true},
		{"gpuImages", "images", true, true},
		{"gpuInstanceTypes", "instanceTypes", true, true},
		{"providerVersions", "", false, false},
		{"", "", false, false},
	}
	for _, c := range cases {
		base, gpuOnly, ok := ParseKind(c.kind)
		if base != c.base || gpuOnly != c.gpuOnly || ok != c.ok {
			t.Errorf("ParseKind(%q) = %q, %v, %v; want %q, %v, %v",
				c.kind, base, gpuOnly, ok, c.base, c.gpuOnly, c.ok)
		}
	}
}

func TestFilterGPU(t *testing.T) {
	in := []Item{
		{Value: "cpu", Label: "cpu"},
		{Value: "gpu", Label: "gpu", GPU: true, GPUSpec: "NVIDIA T4", GPUCount: 1},
	}
	got := FilterGPU(in)
	if len(got) != 1 || got[0].Value != "gpu" {
		t.Fatalf("FilterGPU = %+v", got)
	}
}

func TestGPULabel(t *testing.T) {
	if got := GPULabel("gn6i.xlarge", "NVIDIA T4", 1); got != "gn6i.xlarge [1x NVIDIA T4]" {
		t.Errorf("GPULabel integer: %q", got)
	}
	if got := GPULabel("vgn6i.2xlarge", "NVIDIA T4", 0.25); got != "vgn6i.2xlarge [0.25x NVIDIA T4]" {
		t.Errorf("GPULabel fraction: %q", got)
	}
	if got := GPULabel("g4dn.xlarge", "", 0); got != "g4dn.xlarge" {
		t.Errorf("GPULabel empty: %q", got)
	}
}

func TestLooksLikeGPUImage(t *testing.T) {
	if !LooksLikeGPUImage("Ubuntu 22.04 CUDA 12.4", "NVIDIA driver") {
		t.Fatal("expected CUDA image to match")
	}
	if !LooksLikeGPUImage("Deep Learning AMI GPU PyTorch 2.1") {
		t.Fatal("expected DLAMI to match")
	}
	if !LooksLikeGPUImage("Tesla T4 optimized") {
		t.Fatal("expected T4 token to match")
	}
	if LooksLikeGPUImage("Ubuntu 22.04 LTS", "generic server") {
		t.Fatal("generic image should not match")
	}
	if LooksLikeGPUImage("amzn2-ami-hvm-t4g.xlarge") {
		t.Fatal("Graviton t4g should not match as GPU")
	}
}

func TestHandlerGPUKinds(t *testing.T) {
	gin.SetMode(gin.TestMode)
	h := NewHandler(map[string]Provider{
		"aliyun": stubProvider{
			images: []Item{
				{Value: "img-cpu", Label: "Ubuntu"},
				{Value: "img-gpu", Label: "Ubuntu CUDA", GPU: true},
			},
			types: []Item{
				{Value: "ecs.t5", Label: "ecs.t5"},
				{Value: "ecs.gn6i", Label: "ecs.gn6i", GPU: true, GPUSpec: "NVIDIA T4", GPUCount: 1},
			},
		},
	}, 0)
	r := gin.New()
	h.Register(r)

	get := func(path string) []Item {
		w := httptest.NewRecorder()
		req := httptest.NewRequest(http.MethodGet, path, nil)
		r.ServeHTTP(w, req)
		if w.Code != http.StatusOK {
			t.Fatalf("%s: status %d body %s", path, w.Code, w.Body.String())
		}
		var body struct {
			Items []Item `json:"items"`
		}
		if err := json.Unmarshal(w.Body.Bytes(), &body); err != nil {
			t.Fatalf("%s: decode: %v", path, err)
		}
		return body.Items
	}

	if got := get("/api/gpuInstanceTypes/aliyun/cn-hangzhou"); len(got) != 1 || got[0].Value != "ecs.gn6i" || !got[0].GPU {
		t.Fatalf("gpuInstanceTypes: %+v", got)
	}
	if got := get("/api/gpuImages/aliyun/cn-hangzhou"); len(got) != 1 || got[0].Value != "img-gpu" {
		t.Fatalf("gpuImages: %+v", got)
	}
	if got := get("/api/instanceTypes/aliyun/cn-hangzhou"); len(got) != 2 {
		t.Fatalf("instanceTypes: %+v", got)
	}
}

func TestNormalizeMergesGPU(t *testing.T) {
	got := Normalize([]Item{
		{Value: "gn6i.xlarge", Label: "gn6i.xlarge", Zones: []string{"cn-hangzhou-h"}},
		{Value: "gn6i.xlarge", Label: "gn6i.xlarge", GPU: true, GPUSpec: "NVIDIA T4", GPUCount: 1, Zones: []string{"cn-hangzhou-i"}},
	})
	if len(got) != 1 {
		t.Fatalf("len = %d", len(got))
	}
	it := got[0]
	if !it.GPU || it.GPUSpec != "NVIDIA T4" || it.GPUCount != 1 {
		t.Errorf("gpu fields: %+v", it)
	}
	if !reflect.DeepEqual(it.Zones, []string{"cn-hangzhou-h", "cn-hangzhou-i"}) {
		t.Errorf("zones: %v", it.Zones)
	}
}
