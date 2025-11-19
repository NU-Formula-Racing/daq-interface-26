//Generated CAN Code
#include <esp_can.h>
ESPCAN can_bus{};

// Message: BMS_Voltages_0
MakeSignedCANSignal(float, 0, 8, 0.012, 2) Cell_V_0{};
MakeSignedCANSignal(float, 8, 8, 0.012, 2) Cell_V_1{};
MakeSignedCANSignal(float, 16, 8, 0.012, 2) Cell_V_2{};
MakeSignedCANSignal(float, 24, 8, 0.012, 2) Cell_V_3{};
MakeSignedCANSignal(float, 32, 8, 0.012, 2) Cell_V_4{};
MakeSignedCANSignal(float, 40, 8, 0.012, 2) Cell_V_5{};
MakeSignedCANSignal(float, 48, 8, 0.012, 2) Cell_V_6{};
MakeSignedCANSignal(float, 56, 8, 0.004, 0) Cell_OCV_Offset_0{};

CANRXMessage<8> BMS_Voltages_0{can_bus, 0x200, []() { Serial.println(BMS_Voltages_0.GetLastReceiveTime()); }, Cell_V_0, Cell_V_1, Cell_V_2, Cell_V_3, Cell_V_4, Cell_V_5, Cell_V_6, Cell_OCV_Offset_0};

// Message: BMS_Voltages_1
MakeSignedCANSignal(float, 0, 8, 0.012, 2) Cell_V_7{};
MakeSignedCANSignal(float, 8, 8, 0.012, 2) Cell_V_8{};
MakeSignedCANSignal(float, 16, 8, 0.012, 2) Cell_V_9{};
MakeSignedCANSignal(float, 24, 8, 0.012, 2) Cell_V_10{};
MakeSignedCANSignal(float, 32, 8, 0.012, 2) Cell_V_11{};
MakeSignedCANSignal(float, 40, 8, 0.012, 2) Cell_V_12{};
MakeSignedCANSignal(float, 48, 8, 0.012, 2) Cell_V_13{};
MakeSignedCANSignal(float, 56, 8, 0.004, 0) Cell_OCV_Offset_1{};

CANRXMessage<8> BMS_Voltages_1{can_bus, 0x201, []() { Serial.println(BMS_Voltages_1.GetLastReceiveTime()); }, Cell_V_7, Cell_V_8, Cell_V_9, Cell_V_10, Cell_V_11, Cell_V_12, Cell_V_13, Cell_OCV_Offset_1};

// Message: BMS_Voltages_2
MakeSignedCANSignal(float, 0, 8, 0.012, 2) Cell_V_14{};
MakeSignedCANSignal(float, 8, 8, 0.012, 2) Cell_V_15{};
MakeSignedCANSignal(float, 16, 8, 0.012, 2) Cell_V_16{};
MakeSignedCANSignal(float, 24, 8, 0.012, 2) Cell_V_17{};
MakeSignedCANSignal(float, 32, 8, 0.012, 2) Cell_V_18{};
MakeSignedCANSignal(float, 40, 8, 0.012, 2) Cell_V_19{};
MakeSignedCANSignal(float, 48, 8, 0.012, 2) Cell_V_20{};
MakeSignedCANSignal(float, 56, 8, 0.004, 0) Cell_OCV_Offset_2{};

CANRXMessage<8> BMS_Voltages_2{can_bus, 0x202, []() { Serial.println(BMS_Voltages_2.GetLastReceiveTime()); }, Cell_V_14, Cell_V_15, Cell_V_16, Cell_V_17, Cell_V_18, Cell_V_19, Cell_V_20, Cell_OCV_Offset_2};

// Message: BMS_Voltages_3
MakeSignedCANSignal(float, 0, 8, 0.012, 2) Cell_V_21{};
MakeSignedCANSignal(float, 8, 8, 0.012, 2) Cell_V_22{};
MakeSignedCANSignal(float, 16, 8, 0.012, 2) Cell_V_23{};
MakeSignedCANSignal(float, 24, 8, 0.012, 2) Cell_V_24{};
MakeSignedCANSignal(float, 32, 8, 0.012, 2) Cell_V_25{};
MakeSignedCANSignal(float, 40, 8, 0.012, 2) Cell_V_26{};
MakeSignedCANSignal(float, 48, 8, 0.012, 2) Cell_V_27{};
MakeSignedCANSignal(float, 56, 8, 0.004, 0) Cell_OCV_Offset_3{};

CANRXMessage<8> BMS_Voltages_3{can_bus, 0x203, []() { Serial.println(BMS_Voltages_3.GetLastReceiveTime()); }, Cell_V_21, Cell_V_22, Cell_V_23, Cell_V_24, Cell_V_25, Cell_V_26, Cell_V_27, Cell_OCV_Offset_3};

// Message: BMS_Voltages_4
MakeSignedCANSignal(float, 0, 8, 0.012, 2) Cell_V_28{};
MakeSignedCANSignal(float, 8, 8, 0.012, 2) Cell_V_29{};
MakeSignedCANSignal(float, 16, 8, 0.012, 2) Cell_V_30{};
MakeSignedCANSignal(float, 24, 8, 0.012, 2) Cell_V_31{};
MakeSignedCANSignal(float, 32, 8, 0.012, 2) Cell_V_32{};
MakeSignedCANSignal(float, 40, 8, 0.012, 2) Cell_V_33{};
MakeSignedCANSignal(float, 48, 8, 0.012, 2) Cell_V_34{};
MakeSignedCANSignal(float, 56, 8, 0.004, 0) Cell_OCV_Offset_4{};

CANRXMessage<8> BMS_Voltages_4{can_bus, 0x204, []() { Serial.println(BMS_Voltages_4.GetLastReceiveTime()); }, Cell_V_28, Cell_V_29, Cell_V_30, Cell_V_31, Cell_V_32, Cell_V_33, Cell_V_34, Cell_OCV_Offset_4};

// Message: BMS_Voltages_5
MakeSignedCANSignal(float, 0, 8, 0.012, 2) Cell_V_35{};
MakeSignedCANSignal(float, 8, 8, 0.012, 2) Cell_V_36{};
MakeSignedCANSignal(float, 16, 8, 0.012, 2) Cell_V_37{};
MakeSignedCANSignal(float, 24, 8, 0.012, 2) Cell_V_38{};
MakeSignedCANSignal(float, 32, 8, 0.012, 2) Cell_V_39{};
MakeSignedCANSignal(float, 40, 8, 0.012, 2) Cell_V_40{};
MakeSignedCANSignal(float, 48, 8, 0.012, 2) Cell_V_41{};
MakeSignedCANSignal(float, 56, 8, 0.004, 0) Cell_OCV_Offset_5{};

CANRXMessage<8> BMS_Voltages_5{can_bus, 0x205, []() { Serial.println(BMS_Voltages_5.GetLastReceiveTime()); }, Cell_V_35, Cell_V_36, Cell_V_37, Cell_V_38, Cell_V_39, Cell_V_40, Cell_V_41, Cell_OCV_Offset_5};

// Message: BMS_Voltages_6
MakeSignedCANSignal(float, 0, 8, 0.012, 2) Cell_V_42{};
MakeSignedCANSignal(float, 8, 8, 0.012, 2) Cell_V_43{};
MakeSignedCANSignal(float, 16, 8, 0.012, 2) Cell_V_44{};
MakeSignedCANSignal(float, 24, 8, 0.012, 2) Cell_V_45{};
MakeSignedCANSignal(float, 32, 8, 0.012, 2) Cell_V_46{};
MakeSignedCANSignal(float, 40, 8, 0.012, 2) Cell_V_47{};
MakeSignedCANSignal(float, 48, 8, 0.012, 2) Cell_V_48{};
MakeSignedCANSignal(float, 56, 8, 0.004, 0) Cell_OCV_Offset_6{};

CANRXMessage<8> BMS_Voltages_6{can_bus, 0x206, []() { Serial.println(BMS_Voltages_6.GetLastReceiveTime()); }, Cell_V_42, Cell_V_43, Cell_V_44, Cell_V_45, Cell_V_46, Cell_V_47, Cell_V_48, Cell_OCV_Offset_6};

// Message: BMS_Voltages_7
MakeSignedCANSignal(float, 0, 8, 0.012, 2) Cell_V_49{};
MakeSignedCANSignal(float, 8, 8, 0.012, 2) Cell_V_50{};
MakeSignedCANSignal(float, 16, 8, 0.012, 2) Cell_V_51{};
MakeSignedCANSignal(float, 24, 8, 0.012, 2) Cell_V_52{};
MakeSignedCANSignal(float, 32, 8, 0.012, 2) Cell_V_53{};
MakeSignedCANSignal(float, 40, 8, 0.012, 2) Cell_V_54{};
MakeSignedCANSignal(float, 48, 8, 0.012, 2) Cell_V_55{};
MakeSignedCANSignal(float, 56, 8, 0.004, 0) Cell_OCV_Offset_7{};

CANRXMessage<8> BMS_Voltages_7{can_bus, 0x207, []() { Serial.println(BMS_Voltages_7.GetLastReceiveTime()); }, Cell_V_49, Cell_V_50, Cell_V_51, Cell_V_52, Cell_V_53, Cell_V_54, Cell_V_55, Cell_OCV_Offset_7};

// Message: BMS_Voltages_8
MakeSignedCANSignal(float, 0, 8, 0.012, 2) Cell_V_56{};
MakeSignedCANSignal(float, 8, 8, 0.012, 2) Cell_V_57{};
MakeSignedCANSignal(float, 16, 8, 0.012, 2) Cell_V_58{};
MakeSignedCANSignal(float, 24, 8, 0.012, 2) Cell_V_59{};
MakeSignedCANSignal(float, 32, 8, 0.012, 2) Cell_V_60{};
MakeSignedCANSignal(float, 40, 8, 0.012, 2) Cell_V_61{};
MakeSignedCANSignal(float, 48, 8, 0.012, 2) Cell_V_62{};
MakeSignedCANSignal(float, 56, 8, 0.004, 0) Cell_OCV_Offset_8{};

CANRXMessage<8> BMS_Voltages_8{can_bus, 0x208, []() { Serial.println(BMS_Voltages_8.GetLastReceiveTime()); }, Cell_V_56, Cell_V_57, Cell_V_58, Cell_V_59, Cell_V_60, Cell_V_61, Cell_V_62, Cell_OCV_Offset_8};

// Message: BMS_Voltages_9
MakeSignedCANSignal(float, 0, 8, 0.012, 2) Cell_V_63{};
MakeSignedCANSignal(float, 8, 8, 0.012, 2) Cell_V_64{};
MakeSignedCANSignal(float, 16, 8, 0.012, 2) Cell_V_65{};
MakeSignedCANSignal(float, 24, 8, 0.012, 2) Cell_V_66{};
MakeSignedCANSignal(float, 32, 8, 0.012, 2) Cell_V_67{};
MakeSignedCANSignal(float, 40, 8, 0.012, 2) Cell_V_68{};
MakeSignedCANSignal(float, 48, 8, 0.012, 2) Cell_V_69{};
MakeSignedCANSignal(float, 56, 8, 0.004, 0) Cell_OCV_Offset_9{};

CANRXMessage<8> BMS_Voltages_9{can_bus, 0x209, []() { Serial.println(BMS_Voltages_9.GetLastReceiveTime()); }, Cell_V_63, Cell_V_64, Cell_V_65, Cell_V_66, Cell_V_67, Cell_V_68, Cell_V_69, Cell_OCV_Offset_9};

// Message: BMS_Voltages_10
MakeSignedCANSignal(float, 0, 8, 0.012, 2) Cell_V_70{};
MakeSignedCANSignal(float, 8, 8, 0.012, 2) Cell_V_71{};
MakeSignedCANSignal(float, 16, 8, 0.012, 2) Cell_V_72{};
MakeSignedCANSignal(float, 24, 8, 0.012, 2) Cell_V_73{};
MakeSignedCANSignal(float, 32, 8, 0.012, 2) Cell_V_74{};
MakeSignedCANSignal(float, 40, 8, 0.012, 2) Cell_V_75{};
MakeSignedCANSignal(float, 48, 8, 0.012, 2) Cell_V_76{};
MakeSignedCANSignal(float, 56, 8, 0.004, 0) Cell_OCV_Offset_110{};

CANRXMessage<8> BMS_Voltages_10{can_bus, 0x20a, []() { Serial.println(BMS_Voltages_10.GetLastReceiveTime()); }, Cell_V_70, Cell_V_71, Cell_V_72, Cell_V_73, Cell_V_74, Cell_V_75, Cell_V_76, Cell_OCV_Offset_110};

// Message: BMS_Voltages_11
MakeSignedCANSignal(float, 0, 8, 0.012, 2) Cell_V_77{};
MakeSignedCANSignal(float, 8, 8, 0.012, 2) Cell_V_78{};
MakeSignedCANSignal(float, 16, 8, 0.012, 2) Cell_V_79{};
MakeSignedCANSignal(float, 24, 8, 0.012, 2) Cell_V_80{};
MakeSignedCANSignal(float, 32, 8, 0.012, 2) Cell_V_81{};
MakeSignedCANSignal(float, 40, 8, 0.012, 2) Cell_V_82{};
MakeSignedCANSignal(float, 48, 8, 0.012, 2) Cell_V_83{};
MakeSignedCANSignal(float, 56, 8, 0.004, 0) Cell_OCV_Offset_211{};

CANRXMessage<8> BMS_Voltages_11{can_bus, 0x20b, []() { Serial.println(BMS_Voltages_11.GetLastReceiveTime()); }, Cell_V_77, Cell_V_78, Cell_V_79, Cell_V_80, Cell_V_81, Cell_V_82, Cell_V_83, Cell_OCV_Offset_211};

// Message: BMS_Voltages_12
MakeSignedCANSignal(float, 0, 8, 0.012, 2) Cell_V_84{};
MakeSignedCANSignal(float, 8, 8, 0.012, 2) Cell_V_85{};
MakeSignedCANSignal(float, 16, 8, 0.012, 2) Cell_V_86{};
MakeSignedCANSignal(float, 24, 8, 0.012, 2) Cell_V_87{};
MakeSignedCANSignal(float, 32, 8, 0.012, 2) Cell_V_88{};
MakeSignedCANSignal(float, 40, 8, 0.012, 2) Cell_V_89{};
MakeSignedCANSignal(float, 48, 8, 0.012, 2) Cell_V_90{};
MakeSignedCANSignal(float, 56, 8, 0.004, 0) Cell_OCV_Offset_212{};

CANRXMessage<8> BMS_Voltages_12{can_bus, 0x20c, []() { Serial.println(BMS_Voltages_12.GetLastReceiveTime()); }, Cell_V_84, Cell_V_85, Cell_V_86, Cell_V_87, Cell_V_88, Cell_V_89, Cell_V_90, Cell_OCV_Offset_212};

// Message: BMS_Voltages_13
MakeSignedCANSignal(float, 0, 8, 0.012, 2) Cell_V_91{};
MakeSignedCANSignal(float, 8, 8, 0.012, 2) Cell_V_92{};
MakeSignedCANSignal(float, 16, 8, 0.012, 2) Cell_V_93{};
MakeSignedCANSignal(float, 24, 8, 0.012, 2) Cell_V_94{};
MakeSignedCANSignal(float, 32, 8, 0.012, 2) Cell_V_95{};
MakeSignedCANSignal(float, 40, 8, 0.012, 2) Cell_V_96{};
MakeSignedCANSignal(float, 48, 8, 0.012, 2) Cell_V_97{};
MakeSignedCANSignal(float, 56, 8, 0.004, 0) Cell_OCV_Offset_213{};

CANRXMessage<8> BMS_Voltages_13{can_bus, 0x20d, []() { Serial.println(BMS_Voltages_13.GetLastReceiveTime()); }, Cell_V_91, Cell_V_92, Cell_V_93, Cell_V_94, Cell_V_95, Cell_V_96, Cell_V_97, Cell_OCV_Offset_213};

// Message: BMS_Voltages_14
MakeSignedCANSignal(float, 0, 8, 0.012, 2) Cell_V_98{};
MakeSignedCANSignal(float, 8, 8, 0.012, 2) Cell_V_99{};
MakeSignedCANSignal(float, 16, 8, 0.012, 2) Cell_V_100{};
MakeSignedCANSignal(float, 24, 8, 0.012, 2) Cell_V_101{};
MakeSignedCANSignal(float, 32, 8, 0.012, 2) Cell_V_102{};
MakeSignedCANSignal(float, 40, 8, 0.012, 2) Cell_V_103{};
MakeSignedCANSignal(float, 48, 8, 0.012, 2) Cell_V_104{};
MakeSignedCANSignal(float, 56, 8, 0.004, 0) Cell_OCV_Offset_214{};

CANRXMessage<8> BMS_Voltages_14{can_bus, 0x20e, []() { Serial.println(BMS_Voltages_14.GetLastReceiveTime()); }, Cell_V_98, Cell_V_99, Cell_V_100, Cell_V_101, Cell_V_102, Cell_V_103, Cell_V_104, Cell_OCV_Offset_214};

// Message: BMS_Voltages_15
MakeSignedCANSignal(float, 0, 8, 0.012, 2) Cell_V_105{};
MakeSignedCANSignal(float, 8, 8, 0.012, 2) Cell_V_106{};
MakeSignedCANSignal(float, 16, 8, 0.012, 2) Cell_V_107{};
MakeSignedCANSignal(float, 24, 8, 0.012, 2) Cell_V_108{};
MakeSignedCANSignal(float, 32, 8, 0.012, 2) Cell_V_109{};
MakeSignedCANSignal(float, 40, 8, 0.012, 2) Cell_V_110{};
MakeSignedCANSignal(float, 48, 8, 0.012, 2) Cell_V_111{};
MakeSignedCANSignal(float, 56, 8, 0.004, 0) Cell_OCV_Offset_115{};

CANRXMessage<8> BMS_Voltages_15{can_bus, 0x20f, []() { Serial.println(BMS_Voltages_15.GetLastReceiveTime()); }, Cell_V_105, Cell_V_106, Cell_V_107, Cell_V_108, Cell_V_109, Cell_V_110, Cell_V_111, Cell_OCV_Offset_115};

// Message: BMS_Voltages_16
MakeSignedCANSignal(float, 0, 8, 0.012, 2) Cell_V_112{};
MakeSignedCANSignal(float, 8, 8, 0.012, 2) Cell_V_113{};
MakeSignedCANSignal(float, 16, 8, 0.012, 2) Cell_V_114{};
MakeSignedCANSignal(float, 24, 8, 0.012, 2) Cell_V_115{};
MakeSignedCANSignal(float, 32, 8, 0.012, 2) Cell_V_116{};
MakeSignedCANSignal(float, 40, 8, 0.012, 2) Cell_V_117{};
MakeSignedCANSignal(float, 48, 8, 0.012, 2) Cell_V_118{};
MakeSignedCANSignal(float, 56, 8, 0.004, 0) Cell_OCV_Offset_216{};

CANRXMessage<8> BMS_Voltages_16{can_bus, 0x210, []() { Serial.println(BMS_Voltages_16.GetLastReceiveTime()); }, Cell_V_112, Cell_V_113, Cell_V_114, Cell_V_115, Cell_V_116, Cell_V_117, Cell_V_118, Cell_OCV_Offset_216};

// Message: BMS_Voltages_17
MakeSignedCANSignal(float, 0, 8, 0.012, 2) Cell_V_119{};
MakeSignedCANSignal(float, 8, 8, 0.012, 2) Cell_V_120{};
MakeSignedCANSignal(float, 16, 8, 0.012, 2) Cell_V_121{};
MakeSignedCANSignal(float, 24, 8, 0.012, 2) Cell_V_122{};
MakeSignedCANSignal(float, 32, 8, 0.012, 2) Cell_V_123{};
MakeSignedCANSignal(float, 40, 8, 0.012, 2) Cell_V_124{};
MakeSignedCANSignal(float, 48, 8, 0.012, 2) Cell_V_125{};
MakeSignedCANSignal(float, 56, 8, 0.004, 0) Cell_OCV_Offset_217{};

CANRXMessage<8> BMS_Voltages_17{can_bus, 0x211, []() { Serial.println(BMS_Voltages_17.GetLastReceiveTime()); }, Cell_V_119, Cell_V_120, Cell_V_121, Cell_V_122, Cell_V_123, Cell_V_124, Cell_V_125, Cell_OCV_Offset_217};

// Message: BMS_Voltages_18
MakeSignedCANSignal(float, 0, 8, 0.012, 2) Cell_V_126{};
MakeSignedCANSignal(float, 8, 8, 0.012, 2) Cell_V_127{};
MakeSignedCANSignal(float, 16, 8, 0.012, 2) Cell_V_128{};
MakeSignedCANSignal(float, 24, 8, 0.012, 2) Cell_V_129{};
MakeSignedCANSignal(float, 32, 8, 0.012, 2) Cell_V_130{};
MakeSignedCANSignal(float, 40, 8, 0.012, 2) Cell_V_131{};
MakeSignedCANSignal(float, 48, 8, 0.012, 2) Cell_V_132{};
MakeSignedCANSignal(float, 56, 8, 0.004, 0) Cell_OCV_Offset_218{};

CANRXMessage<8> BMS_Voltages_18{can_bus, 0x212, []() { Serial.println(BMS_Voltages_18.GetLastReceiveTime()); }, Cell_V_126, Cell_V_127, Cell_V_128, Cell_V_129, Cell_V_130, Cell_V_131, Cell_V_132, Cell_OCV_Offset_218};

// Message: BMS_Voltages_19
MakeSignedCANSignal(float, 0, 8, 0.012, 2) Cell_V_133{};
MakeSignedCANSignal(float, 8, 8, 0.012, 2) Cell_V_134{};
MakeSignedCANSignal(float, 16, 8, 0.012, 2) Cell_V_135{};
MakeSignedCANSignal(float, 24, 8, 0.012, 2) Cell_V_136{};
MakeSignedCANSignal(float, 32, 8, 0.012, 2) Cell_V_137{};
MakeSignedCANSignal(float, 40, 8, 0.012, 2) Cell_V_138{};
MakeSignedCANSignal(float, 48, 8, 0.012, 2) Cell_V_139{};
MakeSignedCANSignal(float, 56, 8, 0.004, 0) Cell_OCV_Offset_219{};

CANRXMessage<8> BMS_Voltages_19{can_bus, 0x213, []() { Serial.println(BMS_Voltages_19.GetLastReceiveTime()); }, Cell_V_133, Cell_V_134, Cell_V_135, Cell_V_136, Cell_V_137, Cell_V_138, Cell_V_139, Cell_OCV_Offset_219};

// Message: BMS_Temperatures_0
MakeSignedCANSignal(float, 0, 8, 1.0, -40) Cell_T_0{};
MakeSignedCANSignal(float, 8, 8, 1.0, -40) Cell_T_1{};
MakeSignedCANSignal(float, 16, 8, 1.0, -40) Cell_T_2{};
MakeSignedCANSignal(float, 24, 8, 1.0, -40) Cell_T_3{};
MakeSignedCANSignal(float, 32, 8, 1.0, -40) Cell_T_4{};
MakeSignedCANSignal(float, 40, 8, 1.0, -40) Cell_T_5{};
MakeSignedCANSignal(float, 48, 8, 1.0, -40) Cell_T_6{};

CANRXMessage<7> BMS_Temperatures_0{can_bus, 0x220, []() { Serial.println(BMS_Temperatures_0.GetLastReceiveTime()); }, Cell_T_0, Cell_T_1, Cell_T_2, Cell_T_3, Cell_T_4, Cell_T_5, Cell_T_6};

// Message: BMS_Temperatures_1
MakeSignedCANSignal(float, 0, 8, 1.0, -40) Cell_T_7{};
MakeSignedCANSignal(float, 8, 8, 1.0, -40) Cell_T_8{};
MakeSignedCANSignal(float, 16, 8, 1.0, -40) Cell_T_9{};
MakeSignedCANSignal(float, 24, 8, 1.0, -40) Cell_T_10{};
MakeSignedCANSignal(float, 32, 8, 1.0, -40) Cell_T_11{};
MakeSignedCANSignal(float, 40, 8, 1.0, -40) Cell_T_12{};
MakeSignedCANSignal(float, 48, 8, 1.0, -40) Cell_T_13{};

CANRXMessage<7> BMS_Temperatures_1{can_bus, 0x221, []() { Serial.println(BMS_Temperatures_1.GetLastReceiveTime()); }, Cell_T_7, Cell_T_8, Cell_T_9, Cell_T_10, Cell_T_11, Cell_T_12, Cell_T_13};

// Message: BMS_Temperatures_2
MakeSignedCANSignal(float, 0, 8, 1.0, -40) Cell_T_14{};
MakeSignedCANSignal(float, 8, 8, 1.0, -40) Cell_T_15{};
MakeSignedCANSignal(float, 16, 8, 1.0, -40) Cell_T_16{};
MakeSignedCANSignal(float, 24, 8, 1.0, -40) Cell_T_17{};
MakeSignedCANSignal(float, 32, 8, 1.0, -40) Cell_T_18{};
MakeSignedCANSignal(float, 40, 8, 1.0, -40) Cell_T_19{};
MakeSignedCANSignal(float, 48, 8, 1.0, -40) Cell_T_20{};

CANRXMessage<7> BMS_Temperatures_2{can_bus, 0x222, []() { Serial.println(BMS_Temperatures_2.GetLastReceiveTime()); }, Cell_T_14, Cell_T_15, Cell_T_16, Cell_T_17, Cell_T_18, Cell_T_19, Cell_T_20};

// Message: BMS_Temperatures_3
MakeSignedCANSignal(float, 0, 8, 1.0, -40) Cell_T_21{};
MakeSignedCANSignal(float, 8, 8, 1.0, -40) Cell_T_22{};
MakeSignedCANSignal(float, 16, 8, 1.0, -40) Cell_T_23{};
MakeSignedCANSignal(float, 24, 8, 1.0, -40) Cell_T_24{};
MakeSignedCANSignal(float, 32, 8, 1.0, -40) Cell_T_25{};
MakeSignedCANSignal(float, 40, 8, 1.0, -40) Cell_T_26{};
MakeSignedCANSignal(float, 48, 8, 1.0, -40) Cell_T_27{};

CANRXMessage<7> BMS_Temperatures_3{can_bus, 0x223, []() { Serial.println(BMS_Temperatures_3.GetLastReceiveTime()); }, Cell_T_21, Cell_T_22, Cell_T_23, Cell_T_24, Cell_T_25, Cell_T_26, Cell_T_27};

// Message: BMS_Temperatures_4
MakeSignedCANSignal(float, 0, 8, 1.0, -40) Cell_T_28{};
MakeSignedCANSignal(float, 8, 8, 1.0, -40) Cell_T_29{};
MakeSignedCANSignal(float, 16, 8, 1.0, -40) Cell_T_30{};
MakeSignedCANSignal(float, 24, 8, 1.0, -40) Cell_T_31{};
MakeSignedCANSignal(float, 32, 8, 1.0, -40) Cell_T_32{};
MakeSignedCANSignal(float, 40, 8, 1.0, -40) Cell_T_33{};
MakeSignedCANSignal(float, 48, 8, 1.0, -40) Cell_T_34{};

CANRXMessage<7> BMS_Temperatures_4{can_bus, 0x224, []() { Serial.println(BMS_Temperatures_4.GetLastReceiveTime()); }, Cell_T_28, Cell_T_29, Cell_T_30, Cell_T_31, Cell_T_32, Cell_T_33, Cell_T_34};

// Message: BMS_Temperatures_5
MakeSignedCANSignal(float, 0, 8, 1.0, -40) Cell_T_35{};
MakeSignedCANSignal(float, 8, 8, 1.0, -40) Cell_T_36{};
MakeSignedCANSignal(float, 16, 8, 1.0, -40) Cell_T_37{};
MakeSignedCANSignal(float, 24, 8, 1.0, -40) Cell_T_38{};
MakeSignedCANSignal(float, 32, 8, 1.0, -40) Cell_T_39{};
MakeSignedCANSignal(float, 40, 8, 1.0, -40) Cell_T_40{};
MakeSignedCANSignal(float, 48, 8, 1.0, -40) Cell_T_41{};

CANRXMessage<7> BMS_Temperatures_5{can_bus, 0x225, []() { Serial.println(BMS_Temperatures_5.GetLastReceiveTime()); }, Cell_T_35, Cell_T_36, Cell_T_37, Cell_T_38, Cell_T_39, Cell_T_40, Cell_T_41};

// Message: BMS_Temperatures_6
MakeSignedCANSignal(float, 0, 8, 1.0, -40) Cell_T_42{};
MakeSignedCANSignal(float, 8, 8, 1.0, -40) Cell_T_43{};
MakeSignedCANSignal(float, 16, 8, 1.0, -40) Cell_T_44{};
MakeSignedCANSignal(float, 24, 8, 1.0, -40) Cell_T_45{};
MakeSignedCANSignal(float, 32, 8, 1.0, -40) Cell_T_46{};
MakeSignedCANSignal(float, 40, 8, 1.0, -40) Cell_T_47{};
MakeSignedCANSignal(float, 48, 8, 1.0, -40) Cell_T_48{};

CANRXMessage<7> BMS_Temperatures_6{can_bus, 0x226, []() { Serial.println(BMS_Temperatures_6.GetLastReceiveTime()); }, Cell_T_42, Cell_T_43, Cell_T_44, Cell_T_45, Cell_T_46, Cell_T_47, Cell_T_48};

// Message: BMS_Temperatures_7
MakeSignedCANSignal(float, 0, 8, 1.0, -40) Cell_T_49{};
MakeSignedCANSignal(float, 8, 8, 1.0, -40) Cell_T_50{};
MakeSignedCANSignal(float, 16, 8, 1.0, -40) Cell_T_51{};
MakeSignedCANSignal(float, 24, 8, 1.0, -40) Cell_T_52{};
MakeSignedCANSignal(float, 32, 8, 1.0, -40) Cell_T_53{};
MakeSignedCANSignal(float, 40, 8, 1.0, -40) Cell_T_54{};
MakeSignedCANSignal(float, 48, 8, 1.0, -40) Cell_T_55{};

CANRXMessage<7> BMS_Temperatures_7{can_bus, 0x227, []() { Serial.println(BMS_Temperatures_7.GetLastReceiveTime()); }, Cell_T_49, Cell_T_50, Cell_T_51, Cell_T_52, Cell_T_53, Cell_T_54, Cell_T_55};

// Message: BMS_Temperatures_8
MakeSignedCANSignal(float, 0, 8, 1.0, -40) Cell_T_56{};
MakeSignedCANSignal(float, 8, 8, 1.0, -40) Cell_T_57{};
MakeSignedCANSignal(float, 16, 8, 1.0, -40) Cell_T_58{};
MakeSignedCANSignal(float, 24, 8, 1.0, -40) Cell_T_59{};
MakeSignedCANSignal(float, 32, 8, 1.0, -40) Cell_T_60{};
MakeSignedCANSignal(float, 40, 8, 1.0, -40) Cell_T_61{};
MakeSignedCANSignal(float, 48, 8, 1.0, -40) Cell_T_62{};

CANRXMessage<7> BMS_Temperatures_8{can_bus, 0x228, []() { Serial.println(BMS_Temperatures_8.GetLastReceiveTime()); }, Cell_T_56, Cell_T_57, Cell_T_58, Cell_T_59, Cell_T_60, Cell_T_61, Cell_T_62};

// Message: BMS_Temperatures_9
MakeSignedCANSignal(float, 0, 8, 1.0, -40) Cell_T_63{};
MakeSignedCANSignal(float, 8, 8, 1.0, -40) Cell_T_64{};
MakeSignedCANSignal(float, 16, 8, 1.0, -40) Cell_T_65{};
MakeSignedCANSignal(float, 24, 8, 1.0, -40) Cell_T_66{};
MakeSignedCANSignal(float, 32, 8, 1.0, -40) Cell_T_67{};
MakeSignedCANSignal(float, 40, 8, 1.0, -40) Cell_T_68{};
MakeSignedCANSignal(float, 48, 8, 1.0, -40) Cell_T_69{};

CANRXMessage<7> BMS_Temperatures_9{can_bus, 0x229, []() { Serial.println(BMS_Temperatures_9.GetLastReceiveTime()); }, Cell_T_63, Cell_T_64, Cell_T_65, Cell_T_66, Cell_T_67, Cell_T_68, Cell_T_69};

// Message: BMS_Temperatures_10
MakeSignedCANSignal(float, 0, 8, 1.0, -40) Cell_T_70{};
MakeSignedCANSignal(float, 8, 8, 1.0, -40) Cell_T_71{};
MakeSignedCANSignal(float, 16, 8, 1.0, -40) Cell_T_72{};
MakeSignedCANSignal(float, 24, 8, 1.0, -40) Cell_T_73{};
MakeSignedCANSignal(float, 32, 8, 1.0, -40) Cell_T_74{};
MakeSignedCANSignal(float, 40, 8, 1.0, -40) Cell_T_75{};
MakeSignedCANSignal(float, 48, 8, 1.0, -40) Cell_T_76{};

CANRXMessage<7> BMS_Temperatures_10{can_bus, 0x22a, []() { Serial.println(BMS_Temperatures_10.GetLastReceiveTime()); }, Cell_T_70, Cell_T_71, Cell_T_72, Cell_T_73, Cell_T_74, Cell_T_75, Cell_T_76};

// Message: BMS_Temperatures_11
MakeSignedCANSignal(float, 0, 8, 1.0, -40) Cell_T_77{};
MakeSignedCANSignal(float, 8, 8, 1.0, -40) Cell_T_78{};
MakeSignedCANSignal(float, 16, 8, 1.0, -40) Cell_T_79{};
MakeSignedCANSignal(float, 24, 8, 1.0, -40) Cell_T_80{};
MakeSignedCANSignal(float, 32, 8, 1.0, -40) Cell_T_81{};
MakeSignedCANSignal(float, 40, 8, 1.0, -40) Cell_T_82{};
MakeSignedCANSignal(float, 48, 8, 1.0, -40) Cell_T_83{};

CANRXMessage<7> BMS_Temperatures_11{can_bus, 0x22b, []() { Serial.println(BMS_Temperatures_11.GetLastReceiveTime()); }, Cell_T_77, Cell_T_78, Cell_T_79, Cell_T_80, Cell_T_81, Cell_T_82, Cell_T_83};

// Message: BMS_Temperatures_12
MakeSignedCANSignal(float, 0, 8, 1.0, -40) Cell_T_84{};
MakeSignedCANSignal(float, 8, 8, 1.0, -40) Cell_T_85{};
MakeSignedCANSignal(float, 16, 8, 1.0, -40) Cell_T_86{};
MakeSignedCANSignal(float, 24, 8, 1.0, -40) Cell_T_87{};
MakeSignedCANSignal(float, 32, 8, 1.0, -40) Cell_T_88{};
MakeSignedCANSignal(float, 40, 8, 1.0, -40) Cell_T_89{};
MakeSignedCANSignal(float, 48, 8, 1.0, -40) Cell_T_90{};

CANRXMessage<7> BMS_Temperatures_12{can_bus, 0x22c, []() { Serial.println(BMS_Temperatures_12.GetLastReceiveTime()); }, Cell_T_84, Cell_T_85, Cell_T_86, Cell_T_87, Cell_T_88, Cell_T_89, Cell_T_90};

// Message: BMS_Temperatures_13
MakeSignedCANSignal(float, 0, 8, 1.0, -40) Cell_T_91{};
MakeSignedCANSignal(float, 8, 8, 1.0, -40) Cell_T_92{};
MakeSignedCANSignal(float, 16, 8, 1.0, -40) Cell_T_93{};
MakeSignedCANSignal(float, 24, 8, 1.0, -40) Cell_T_94{};
MakeSignedCANSignal(float, 32, 8, 1.0, -40) Cell_T_95{};
MakeSignedCANSignal(float, 40, 8, 1.0, -40) Cell_T_96{};
MakeSignedCANSignal(float, 48, 8, 1.0, -40) Cell_T_97{};

CANRXMessage<7> BMS_Temperatures_13{can_bus, 0x22d, []() { Serial.println(BMS_Temperatures_13.GetLastReceiveTime()); }, Cell_T_91, Cell_T_92, Cell_T_93, Cell_T_94, Cell_T_95, Cell_T_96, Cell_T_97};

// Message: BMS_Temperatures_14
MakeSignedCANSignal(float, 0, 8, 1.0, -40) Cell_T_98{};
MakeSignedCANSignal(float, 8, 8, 1.0, -40) Cell_T_99{};
MakeSignedCANSignal(float, 16, 8, 1.0, -40) Cell_T_100{};
MakeSignedCANSignal(float, 24, 8, 1.0, -40) Cell_T_101{};
MakeSignedCANSignal(float, 32, 8, 1.0, -40) Cell_T_102{};
MakeSignedCANSignal(float, 40, 8, 1.0, -40) Cell_T_103{};
MakeSignedCANSignal(float, 48, 8, 1.0, -40) Cell_T_104{};

CANRXMessage<7> BMS_Temperatures_14{can_bus, 0x22e, []() { Serial.println(BMS_Temperatures_14.GetLastReceiveTime()); }, Cell_T_98, Cell_T_99, Cell_T_100, Cell_T_101, Cell_T_102, Cell_T_103, Cell_T_104};

// Message: BMS_Temperatures_15
MakeSignedCANSignal(float, 0, 8, 1.0, -40) Cell_T_105{};
MakeSignedCANSignal(float, 8, 8, 1.0, -40) Cell_T_106{};
MakeSignedCANSignal(float, 16, 8, 1.0, -40) Cell_T_107{};
MakeSignedCANSignal(float, 24, 8, 1.0, -40) Cell_T_108{};
MakeSignedCANSignal(float, 32, 8, 1.0, -40) Cell_T_109{};
MakeSignedCANSignal(float, 40, 8, 1.0, -40) Cell_T_110{};
MakeSignedCANSignal(float, 48, 8, 1.0, -40) Cell_T_111{};

CANRXMessage<7> BMS_Temperatures_15{can_bus, 0x22f, []() { Serial.println(BMS_Temperatures_15.GetLastReceiveTime()); }, Cell_T_105, Cell_T_106, Cell_T_107, Cell_T_108, Cell_T_109, Cell_T_110, Cell_T_111};

// Message: BMS_SOE
MakeSignedCANSignal(float, 0, 12, 0.1, 0) Max_Discharge_Current{};
MakeSignedCANSignal(float, 12, 12, 0.1, 0) Max_Regen_Current{};
MakeSignedCANSignal(float, 24, 16, 0.01, 0) Battery_Voltage{};
MakeSignedCANSignal(float, 40, 8, 1.0, -40) Battery_Temperature{};
MakeSignedCANSignal(float, 48, 16, 0.01, 0) Battery_Current{};

CANRXMessage<5> BMS_SOE{can_bus, 0x240, []() { Serial.println(BMS_SOE.GetLastReceiveTime()); }, Max_Discharge_Current, Max_Regen_Current, Battery_Voltage, Battery_Temperature, Battery_Current};

// Message: BMS_Status
MakeSignedCANSignal(float, 0, 8, 1.0, 0) BMS_State{};
MakeSignedCANSignal(float, 8, 8, 1.0, -40) Max_Cell_Temp{};
MakeSignedCANSignal(float, 16, 8, 1.0, -40) Min_Cell_Temp{};
MakeSignedCANSignal(float, 24, 8, 0.012, 2) Max_Cell_Voltage{};
MakeSignedCANSignal(float, 32, 8, 0.012, 2) Min_Cell_Voltage{};
MakeSignedCANSignal(float, 40, 8, 0.5, 0) BMS_SOC{};

CANRXMessage<6> BMS_Status{can_bus, 0x241, []() { Serial.println(BMS_Status.GetLastReceiveTime()); }, BMS_State, Max_Cell_Temp, Min_Cell_Temp, Max_Cell_Voltage, Min_Cell_Voltage, BMS_SOC};

// Message: BMS_CMD
MakeSignedCANSignal(float, 0, 8, 1.0, 0) BMS_Command{};

CANRXMessage<1> BMS_CMD{can_bus, 0x242, []() { Serial.println(BMS_CMD.GetLastReceiveTime()); }, BMS_Command};

// Message: BMS_Faults
MakeSignedCANSignal(float, 0, 1, 1.0, 0) Fault_Summary{};
MakeSignedCANSignal(float, 1, 1, 1.0, 0) Undervoltage_Fault{};
MakeSignedCANSignal(float, 2, 1, 1.0, 0) Overvoltage_Fault{};
MakeSignedCANSignal(float, 3, 1, 1.0, 0) Undertemperature_Fault{};
MakeSignedCANSignal(float, 4, 1, 1.0, 0) Overtemperature_Fault{};
MakeSignedCANSignal(float, 5, 1, 1.0, 0) Overcurrent_Fault{};
MakeSignedCANSignal(float, 6, 1, 1.0, 0) External_Kill_Fault{};
MakeSignedCANSignal(float, 7, 1, 1.0, 0) Open_Wire_Fault{};

CANRXMessage<8> BMS_Faults{can_bus, 0x250, []() { Serial.println(BMS_Faults.GetLastReceiveTime()); }, Fault_Summary, Undervoltage_Fault, Overvoltage_Fault, Undertemperature_Fault, Overtemperature_Fault, Overcurrent_Fault, External_Kill_Fault, Open_Wire_Fault};

