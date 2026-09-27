package provider

import (
	"reflect"
	"testing"

	ecsmodel "github.com/huaweicloud/huaweicloud-sdk-go-v3/services/ecs/v2/model"
)

func strPtr(s string) *string { return &s }

func TestHuaweiFlavorAvailability(t *testing.T) {
	region := "cn-north-4"
	cases := []struct {
		name    string
		extra   *ecsmodel.FlavorExtraSpec
		zones   []string
		offered bool
	}{
		{name: "nil extra", extra: nil, offered: true},
		{
			name:    "region sellout",
			extra:   &ecsmodel.FlavorExtraSpec{Condoperationstatus: strPtr("sellout")},
			offered: false,
		},
		{
			name:    "region abandon",
			extra:   &ecsmodel.FlavorExtraSpec{Condoperationstatus: strPtr("abandon")},
			offered: false,
		},
		{
			name: "az letter offered",
			extra: &ecsmodel.FlavorExtraSpec{
				Condoperationstatus: strPtr("abandon"),
				Condoperationaz:     strPtr("a(normal), b(sellout)"),
			},
			zones:   []string{"cn-north-4a"},
			offered: true,
		},
		{
			name: "all listed az sellout uses region status",
			extra: &ecsmodel.FlavorExtraSpec{
				Condoperationstatus: strPtr("normal"),
				Condoperationaz:     strPtr("az0(sellout), az1(sellout)"),
			},
			offered: true,
		},
		{
			name: "unmappable az short name still offered",
			extra: &ecsmodel.FlavorExtraSpec{
				Condoperationstatus: strPtr("abandon"),
				Condoperationaz:     strPtr("az0(normal)"),
			},
			offered: true,
		},
	}
	for _, c := range cases {
		zones, offered := huaweiFlavorAvailability(region, c.extra)
		if offered != c.offered {
			t.Errorf("%s: offered=%v want %v", c.name, offered, c.offered)
		}
		if !reflect.DeepEqual(zones, c.zones) {
			t.Errorf("%s: zones=%v want %v", c.name, zones, c.zones)
		}
	}
}
