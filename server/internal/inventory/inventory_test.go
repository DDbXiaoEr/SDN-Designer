package inventory

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/gin-gonic/gin"

	"ovndesigner/server/internal/catalog"
)

type stubInv struct {
	graph *Graph
	err   error
}

func (s stubInv) Images(context.Context, string) ([]catalog.Item, error) { return nil, nil }
func (s stubInv) InstanceTypes(context.Context, string) ([]catalog.Item, error) {
	return nil, nil
}
func (s stubInv) Inventory(context.Context, string) (*Graph, error) { return s.graph, s.err }

func TestHandlerInventory(t *testing.T) {
	gin.SetMode(gin.TestMode)
	h := NewHandler(map[string]catalog.Provider{
		"aliyun": stubInv{graph: &Graph{
			VPCs:      []VPC{{ID: "vpc-1", Name: "demo", CIDR: "10.0.0.0/16"}},
			Instances: []Instance{{ID: "i-1", Name: "ecs"}},
		}},
	}, 0)
	r := gin.New()
	h.Register(r)

	w := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodGet, "/api/inventory/aliyun/cn-hangzhou", nil)
	r.ServeHTTP(w, req)
	if w.Code != http.StatusOK {
		t.Fatalf("status %d body %s", w.Code, w.Body.String())
	}
	var g Graph
	if err := json.Unmarshal(w.Body.Bytes(), &g); err != nil {
		t.Fatal(err)
	}
	if g.Vendor != "aliyun" || g.Region != "cn-hangzhou" {
		t.Fatalf("meta: %+v", g)
	}
	if len(g.VPCs) != 1 || g.VPCs[0].ID != "vpc-1" {
		t.Fatalf("vpcs: %+v", g.VPCs)
	}
	if len(g.Instances) != 1 || g.Instances[0].Name != "ecs" {
		t.Fatalf("instances: %+v", g.Instances)
	}
}

func TestHandlerInventoryNotCapturedByCatalog(t *testing.T) {
	gin.SetMode(gin.TestMode)
	providers := map[string]catalog.Provider{
		"aliyun": stubInv{graph: &Graph{
			VPCs: []VPC{{ID: "vpc-1", Name: "demo", CIDR: "10.0.0.0/16"}},
		}},
	}
	r := gin.New()
	NewHandler(providers, 0).Register(r)
	catalog.NewHandler(providers, 0).Register(r)

	w := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodGet, "/api/inventory/aliyun/cn-heyuan", nil)
	r.ServeHTTP(w, req)
	if w.Code != http.StatusOK {
		t.Fatalf("status %d body %s", w.Code, w.Body.String())
	}
	var g Graph
	if err := json.Unmarshal(w.Body.Bytes(), &g); err != nil {
		t.Fatal(err)
	}
	if g.Vendor != "aliyun" || g.Region != "cn-heyuan" || len(g.VPCs) != 1 {
		t.Fatalf("graph: %+v", g)
	}
}

func TestHandlerUnsupported(t *testing.T) {
	gin.SetMode(gin.TestMode)
	h := NewHandler(map[string]catalog.Provider{}, 0)
	r := gin.New()
	h.Register(r)
	w := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodGet, "/api/inventory/aliyun/cn-hangzhou", nil)
	r.ServeHTTP(w, req)
	if w.Code != http.StatusNotImplemented {
		t.Fatalf("status %d", w.Code)
	}
}

func TestNormalizeDropsEmpty(t *testing.T) {
	g := &Graph{
		VPCs:     []VPC{{ID: "", Name: "x"}, {ID: "vpc-2", Name: ""}},
		KeyPairs: []KeyPair{{Name: "a"}, {Name: "a"}, {Name: ""}},
	}
	Normalize(g)
	if len(g.VPCs) != 1 || g.VPCs[0].Name != "vpc-2" {
		t.Fatalf("vpcs: %+v", g.VPCs)
	}
	if len(g.KeyPairs) != 1 || g.KeyPairs[0].Name != "a" {
		t.Fatalf("keys: %+v", g.KeyPairs)
	}
}
