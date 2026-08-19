/**
 * GENERATED FILE -- DO NOT EDIT.
 *
 * Projected from backend/models/metrics.json by
 * scripts/export_model_performance.py. Re-run that script after retraining or
 * regenerating the held-out metrics.
 */

export const MODEL_PERFORMANCE = {
  "generated_at": "2026-08-19T04:43:47.611282+00:00",
  "data_is_synthetic": true,
  "caveat": "All scores are measured on synthetic data produced by this project's own physics simulator. They describe how separable the simulated conditions are, not how the model would perform on a real pump. This is not an industrial accuracy claim.",
  "dataset": {
    "rows": 15732,
    "runs": 720,
    "class_counts": {
      "normal": 3840,
      "sensor_fault": 3004,
      "cavitation": 2320,
      "flow_restriction": 1680,
      "dry_run": 1680,
      "misalignment": 1642,
      "imbalance": 1566
    },
    "runs_per_class": {
      "cavitation": 130,
      "dry_run": 70,
      "flow_restriction": 70,
      "imbalance": 70,
      "misalignment": 70,
      "normal": 160,
      "sensor_fault": 150
    },
    "train_rows": 11780,
    "test_rows": 3952,
    "train_runs": 536,
    "test_runs": 184
  },
  "split": {
    "strategy": "StratifiedGroupKFold on run_id, stratified by class; fold 1 of 4 held out",
    "why": "Frames inside one run are consecutive ticks of one machine at one operating point and are near-duplicates. A random row split puts near-identical twins on both sides and measures memorisation."
  },
  "grouped_split": {
    "accuracy": 0.8223684210526315,
    "precision_macro": 0.8810981830552217,
    "recall_macro": 0.8718179112153813,
    "f1_macro": 0.8742574009524612,
    "precision_weighted": 0.8225617353830279,
    "recall_weighted": 0.8223684210526315,
    "f1_weighted": 0.8193859687062383,
    "per_class": {
      "normal": {
        "precision": 0.6185925282363163,
        "recall": 0.7416666666666667,
        "f1-score": 0.6745618190431075,
        "support": 960.0
      },
      "imbalance": {
        "precision": 1.0,
        "recall": 1.0,
        "f1-score": 1.0,
        "support": 389.0
      },
      "misalignment": {
        "precision": 1.0,
        "recall": 1.0,
        "f1-score": 1.0,
        "support": 411.0
      },
      "flow_restriction": {
        "precision": 1.0,
        "recall": 0.9189814814814815,
        "f1-score": 0.9577804583835947,
        "support": 432.0
      },
      "cavitation": {
        "precision": 0.9796264855687606,
        "recall": 1.0,
        "f1-score": 0.9897084048027445,
        "support": 577.0
      },
      "dry_run": {
        "precision": 1.0,
        "recall": 1.0,
        "f1-score": 1.0,
        "support": 432.0
      },
      "sensor_fault": {
        "precision": 0.5694682675814752,
        "recall": 0.4420772303595206,
        "f1-score": 0.49775112443778113,
        "support": 751.0
      },
      "accuracy": 0.8223684210526315,
      "macro avg": {
        "precision": 0.8810981830552217,
        "recall": 0.8718179112153813,
        "f1-score": 0.8742574009524612,
        "support": 3952.0
      },
      "weighted avg": {
        "precision": 0.8225617353830279,
        "recall": 0.8223684210526315,
        "f1-score": 0.819385968706238,
        "support": 3952.0
      }
    },
    "per_class_accuracy": [
      {
        "label": "normal",
        "precision": 0.6185925282363163,
        "recall": 0.7416666666666667,
        "f1_score": 0.6745618190431075,
        "support": 960,
        "accuracy": 0.7416666666666667
      },
      {
        "label": "imbalance",
        "precision": 1.0,
        "recall": 1.0,
        "f1_score": 1.0,
        "support": 389,
        "accuracy": 1.0
      },
      {
        "label": "misalignment",
        "precision": 1.0,
        "recall": 1.0,
        "f1_score": 1.0,
        "support": 411,
        "accuracy": 1.0
      },
      {
        "label": "flow_restriction",
        "precision": 1.0,
        "recall": 0.9189814814814815,
        "f1_score": 0.9577804583835947,
        "support": 432,
        "accuracy": 0.9189814814814815
      },
      {
        "label": "cavitation",
        "precision": 0.9796264855687606,
        "recall": 1.0,
        "f1_score": 0.9897084048027445,
        "support": 577,
        "accuracy": 1.0
      },
      {
        "label": "dry_run",
        "precision": 1.0,
        "recall": 1.0,
        "f1_score": 1.0,
        "support": 432,
        "accuracy": 1.0
      },
      {
        "label": "sensor_fault",
        "precision": 0.5694682675814752,
        "recall": 0.4420772303595206,
        "f1_score": 0.49775112443778113,
        "support": 751,
        "accuracy": 0.4420772303595206
      }
    ],
    "confusion_matrix": {
      "labels": [
        "normal",
        "imbalance",
        "misalignment",
        "flow_restriction",
        "cavitation",
        "dry_run",
        "sensor_fault"
      ],
      "rows_are_true": true,
      "matrix": [
        [
          712,
          0,
          0,
          0,
          0,
          0,
          248
        ],
        [
          0,
          389,
          0,
          0,
          0,
          0,
          0
        ],
        [
          0,
          0,
          411,
          0,
          0,
          0,
          0
        ],
        [
          32,
          0,
          0,
          397,
          0,
          0,
          3
        ],
        [
          0,
          0,
          0,
          0,
          577,
          0,
          0
        ],
        [
          0,
          0,
          0,
          0,
          0,
          432,
          0
        ],
        [
          407,
          0,
          0,
          0,
          12,
          0,
          332
        ]
      ],
      "row_normalized": [
        [
          0.7416666666666667,
          0.0,
          0.0,
          0.0,
          0.0,
          0.0,
          0.25833333333333336
        ],
        [
          0.0,
          1.0,
          0.0,
          0.0,
          0.0,
          0.0,
          0.0
        ],
        [
          0.0,
          0.0,
          1.0,
          0.0,
          0.0,
          0.0,
          0.0
        ],
        [
          0.07407407407407407,
          0.0,
          0.0,
          0.9189814814814815,
          0.0,
          0.0,
          0.006944444444444444
        ],
        [
          0.0,
          0.0,
          0.0,
          0.0,
          1.0,
          0.0,
          0.0
        ],
        [
          0.0,
          0.0,
          0.0,
          0.0,
          0.0,
          1.0,
          0.0
        ],
        [
          0.5419440745672437,
          0.0,
          0.0,
          0.0,
          0.015978695073235686,
          0.0,
          0.4420772303595206
        ]
      ]
    }
  },
  "severity_accuracy": [
    {
      "severity": 0.0,
      "accuracy": 0.7420020639834881,
      "support": 969
    },
    {
      "severity": 0.2,
      "accuracy": 0.9626274065685164,
      "support": 883
    },
    {
      "severity": 0.4,
      "accuracy": 1.0,
      "support": 647
    },
    {
      "severity": 0.6,
      "accuracy": 1.0,
      "support": 402
    },
    {
      "severity": 0.8,
      "accuracy": 1.0,
      "support": 275
    },
    {
      "severity": 1.0,
      "accuracy": 0.46005154639175255,
      "support": 776
    }
  ],
  "leakage_check": {
    "row_split_accuracy": 0.9921558704453441,
    "grouped_split_accuracy": 0.8223684210526315,
    "inflation": 0.16978744939271262,
    "note": "The row-split number is the leaked one. It is recorded to be disbelieved."
  },
  "anomaly_detector": {
    "trained_on": "NORMAL rows of the training split only",
    "training_rows": 2880,
    "score_reference": {
      "healthy_end": 0.1550802774836275,
      "faulty_end": -0.060946530083134054
    },
    "healthy_mean_score": 0.30739333381381845,
    "faulty_mean_score": 0.6353106768124163,
    "roc_auc": 0.8432202888257575,
    "roc_curve": [
      {
        "fpr": 0.0,
        "tpr": 0.0,
        "threshold": Infinity
      },
      {
        "fpr": 0.003125,
        "tpr": 0.07419786096256685,
        "threshold": 0.969652114417475
      },
      {
        "fpr": 0.007291666666666667,
        "tpr": 0.09558823529411764,
        "threshold": 0.9498822383783017
      },
      {
        "fpr": 0.008333333333333333,
        "tpr": 0.13970588235294118,
        "threshold": 0.9238891373989263
      },
      {
        "fpr": 0.010416666666666666,
        "tpr": 0.15975935828877005,
        "threshold": 0.9118843875403586
      },
      {
        "fpr": 0.0125,
        "tpr": 0.1714572192513369,
        "threshold": 0.9041191375191746
      },
      {
        "fpr": 0.015625,
        "tpr": 0.19852941176470587,
        "threshold": 0.8803562074313837
      },
      {
        "fpr": 0.01875,
        "tpr": 0.22225935828877005,
        "threshold": 0.8605941091161501
      },
      {
        "fpr": 0.021875,
        "tpr": 0.23161764705882354,
        "threshold": 0.8549412195016591
      },
      {
        "fpr": 0.023958333333333335,
        "tpr": 0.2393048128342246,
        "threshold": 0.8485212656092035
      },
      {
        "fpr": 0.027083333333333334,
        "tpr": 0.24364973262032086,
        "threshold": 0.8465063281853807
      },
      {
        "fpr": 0.03125,
        "tpr": 0.24766042780748662,
        "threshold": 0.8445712889884083
      },
      {
        "fpr": 0.034375,
        "tpr": 0.2516711229946524,
        "threshold": 0.8407506490832964
      },
      {
        "fpr": 0.0375,
        "tpr": 0.2586898395721925,
        "threshold": 0.8348721185865574
      },
      {
        "fpr": 0.04375,
        "tpr": 0.26938502673796794,
        "threshold": 0.8294745472553507
      },
      {
        "fpr": 0.046875,
        "tpr": 0.28108288770053474,
        "threshold": 0.8227952692719113
      },
      {
        "fpr": 0.05,
        "tpr": 0.29879679144385024,
        "threshold": 0.8140514177320859
      },
      {
        "fpr": 0.053125,
        "tpr": 0.31918449197860965,
        "threshold": 0.8000867478353385
      },
      {
        "fpr": 0.05625,
        "tpr": 0.3285427807486631,
        "threshold": 0.7915333231968079
      },
      {
        "fpr": 0.059375,
        "tpr": 0.339572192513369,
        "threshold": 0.7826754067740457
      },
      {
        "fpr": 0.0625,
        "tpr": 0.3482620320855615,
        "threshold": 0.7784174464580298
      },
      {
        "fpr": 0.065625,
        "tpr": 0.39037433155080214,
        "threshold": 0.7532832547961074
      },
      {
        "fpr": 0.06875,
        "tpr": 0.40808823529411764,
        "threshold": 0.7319732523484325
      },
      {
        "fpr": 0.071875,
        "tpr": 0.410427807486631,
        "threshold": 0.728904993964671
      },
      {
        "fpr": 0.075,
        "tpr": 0.4127673796791444,
        "threshold": 0.7239063062812982
      },
      {
        "fpr": 0.07916666666666666,
        "tpr": 0.41544117647058826,
        "threshold": 0.7192396715561736
      },
      {
        "fpr": 0.08229166666666667,
        "tpr": 0.428475935828877,
        "threshold": 0.7050918526443385
      },
      {
        "fpr": 0.08958333333333333,
        "tpr": 0.43516042780748665,
        "threshold": 0.6983673747991183
      },
      {
        "fpr": 0.09375,
        "tpr": 0.4391711229946524,
        "threshold": 0.6932284649482596
      },
      {
        "fpr": 0.096875,
        "tpr": 0.4451871657754011,
        "threshold": 0.6847530690493426
      },
      {
        "fpr": 0.1,
        "tpr": 0.45187165775401067,
        "threshold": 0.6692646745924457
      },
      {
        "fpr": 0.10416666666666667,
        "tpr": 0.4715909090909091,
        "threshold": 0.6427289927954282
      },
      {
        "fpr": 0.10833333333333334,
        "tpr": 0.5207219251336899,
        "threshold": 0.599679898552255
      },
      {
        "fpr": 0.1125,
        "tpr": 0.5391042780748663,
        "threshold": 0.5868994564658436
      },
      {
        "fpr": 0.115625,
        "tpr": 0.5645053475935828,
        "threshold": 0.5755319548304154
      },
      {
        "fpr": 0.11875,
        "tpr": 0.5952540106951871,
        "threshold": 0.5611175726800226
      },
      {
        "fpr": 0.121875,
        "tpr": 0.6046122994652406,
        "threshold": 0.5563235116301314
      },
      {
        "fpr": 0.125,
        "tpr": 0.6106283422459893,
        "threshold": 0.5534400950880358
      },
      {
        "fpr": 0.12916666666666668,
        "tpr": 0.6453877005347594,
        "threshold": 0.5370206411164918
      },
      {
        "fpr": 0.13229166666666667,
        "tpr": 0.6490641711229946,
        "threshold": 0.5344508377324653
      },
      {
        "fpr": 0.1375,
        "tpr": 0.6560828877005348,
        "threshold": 0.5280260316471403
      },
      {
        "fpr": 0.140625,
        "tpr": 0.6657754010695187,
        "threshold": 0.5205126035750995
      },
      {
        "fpr": 0.14375,
        "tpr": 0.6684491978609626,
        "threshold": 0.5181049607806684
      },
      {
        "fpr": 0.146875,
        "tpr": 0.6721256684491979,
        "threshold": 0.5151727386242579
      },
      {
        "fpr": 0.15,
        "tpr": 0.6747994652406417,
        "threshold": 0.5115066978635621
      },
      {
        "fpr": 0.15416666666666667,
        "tpr": 0.6788101604278075,
        "threshold": 0.5070102879485031
      },
      {
        "fpr": 0.15833333333333333,
        "tpr": 0.6818181818181818,
        "threshold": 0.5047695636885466
      },
      {
        "fpr": 0.1625,
        "tpr": 0.6875,
        "threshold": 0.5006689778447925
      },
      {
        "fpr": 0.165625,
        "tpr": 0.6918449197860963,
        "threshold": 0.49888043505451896
      },
      {
        "fpr": 0.171875,
        "tpr": 0.696524064171123,
        "threshold": 0.4960541061088078
      },
      {
        "fpr": 0.175,
        "tpr": 0.6991978609625669,
        "threshold": 0.4947162041213933
      },
      {
        "fpr": 0.178125,
        "tpr": 0.7025401069518716,
        "threshold": 0.49341842577744255
      },
      {
        "fpr": 0.18229166666666666,
        "tpr": 0.7045454545454546,
        "threshold": 0.4912895271110585
      },
      {
        "fpr": 0.18541666666666667,
        "tpr": 0.7065508021390374,
        "threshold": 0.4895977410256914
      },
      {
        "fpr": 0.18854166666666666,
        "tpr": 0.7112299465240641,
        "threshold": 0.48759464780350154
      },
      {
        "fpr": 0.19479166666666667,
        "tpr": 0.7152406417112299,
        "threshold": 0.48453269902516966
      },
      {
        "fpr": 0.19791666666666666,
        "tpr": 0.7199197860962567,
        "threshold": 0.48124395929749814
      },
      {
        "fpr": 0.20208333333333334,
        "tpr": 0.7242647058823529,
        "threshold": 0.4773274537553192
      },
      {
        "fpr": 0.20625,
        "tpr": 0.7276069518716578,
        "threshold": 0.4757853563163137
      },
      {
        "fpr": 0.209375,
        "tpr": 0.7322860962566845,
        "threshold": 0.47261363458181666
      },
      {
        "fpr": 0.2125,
        "tpr": 0.7332887700534759,
        "threshold": 0.4721467808745085
      },
      {
        "fpr": 0.215625,
        "tpr": 0.7393048128342246,
        "threshold": 0.46834228820504553
      },
      {
        "fpr": 0.21875,
        "tpr": 0.74298128342246,
        "threshold": 0.4670007315008404
      },
      {
        "fpr": 0.22604166666666667,
        "tpr": 0.7473262032085561,
        "threshold": 0.46398803957505413
      },
      {
        "fpr": 0.23020833333333332,
        "tpr": 0.7503342245989305,
        "threshold": 0.4624277265048221
      },
      {
        "fpr": 0.23333333333333334,
        "tpr": 0.7520053475935828,
        "threshold": 0.46086508123584696
      },
      {
        "fpr": 0.2375,
        "tpr": 0.7603609625668449,
        "threshold": 0.4555950456918496
      },
      {
        "fpr": 0.240625,
        "tpr": 0.7623663101604278,
        "threshold": 0.45333437882960576
      },
      {
        "fpr": 0.24479166666666666,
        "tpr": 0.7683823529411765,
        "threshold": 0.4487622503261148
      },
      {
        "fpr": 0.25,
        "tpr": 0.7717245989304813,
        "threshold": 0.4449594509732806
      },
      {
        "fpr": 0.25416666666666665,
        "tpr": 0.7750668449197861,
        "threshold": 0.4417657426956747
      },
      {
        "fpr": 0.25729166666666664,
        "tpr": 0.7777406417112299,
        "threshold": 0.43834052975094384
      },
      {
        "fpr": 0.2604166666666667,
        "tpr": 0.7790775401069518,
        "threshold": 0.43549705605680294
      },
      {
        "fpr": 0.2635416666666667,
        "tpr": 0.786096256684492,
        "threshold": 0.4298651204830158
      },
      {
        "fpr": 0.26666666666666666,
        "tpr": 0.7914438502673797,
        "threshold": 0.42686853284739246
      },
      {
        "fpr": 0.26979166666666665,
        "tpr": 0.7941176470588235,
        "threshold": 0.4238835837050939
      },
      {
        "fpr": 0.27291666666666664,
        "tpr": 0.8048128342245989,
        "threshold": 0.4158115366257646
      },
      {
        "fpr": 0.2760416666666667,
        "tpr": 0.81951871657754,
        "threshold": 0.4027216821291937
      },
      {
        "fpr": 0.2791666666666667,
        "tpr": 0.8238636363636364,
        "threshold": 0.3997759597712199
      },
      {
        "fpr": 0.2833333333333333,
        "tpr": 0.8392379679144385,
        "threshold": 0.38896328707721006
      },
      {
        "fpr": 0.2864583333333333,
        "tpr": 0.8539438502673797,
        "threshold": 0.37522130513872876
      },
      {
        "fpr": 0.28958333333333336,
        "tpr": 0.856951871657754,
        "threshold": 0.3733918960661554
      },
      {
        "fpr": 0.29375,
        "tpr": 0.858957219251337,
        "threshold": 0.3717357813357865
      },
      {
        "fpr": 0.2989583333333333,
        "tpr": 0.8633021390374331,
        "threshold": 0.3664293809121562
      },
      {
        "fpr": 0.30416666666666664,
        "tpr": 0.8673128342245989,
        "threshold": 0.36111160233309664
      },
      {
        "fpr": 0.30833333333333335,
        "tpr": 0.8703208556149733,
        "threshold": 0.3558485325489705
      },
      {
        "fpr": 0.31145833333333334,
        "tpr": 0.8716577540106952,
        "threshold": 0.35385243451994497
      },
      {
        "fpr": 0.3145833333333333,
        "tpr": 0.8790106951871658,
        "threshold": 0.3433777125564857
      },
      {
        "fpr": 0.321875,
        "tpr": 0.8806818181818182,
        "threshold": 0.3394315698915751
      },
      {
        "fpr": 0.32708333333333334,
        "tpr": 0.8836898395721925,
        "threshold": 0.3368978036738907
      },
      {
        "fpr": 0.33125,
        "tpr": 0.8853609625668449,
        "threshold": 0.33427445387079685
      },
      {
        "fpr": 0.33645833333333336,
        "tpr": 0.8880347593582888,
        "threshold": 0.32894502549717985
      },
      {
        "fpr": 0.3458333333333333,
        "tpr": 0.8893716577540107,
        "threshold": 0.324851642831548
      },
      {
        "fpr": 0.35208333333333336,
        "tpr": 0.8903743315508021,
        "threshold": 0.3220374194756667
      },
      {
        "fpr": 0.3572916666666667,
        "tpr": 0.8927139037433155,
        "threshold": 0.31705476332730076
      },
      {
        "fpr": 0.3625,
        "tpr": 0.8947192513368984,
        "threshold": 0.31448547145354405
      },
      {
        "fpr": 0.37604166666666666,
        "tpr": 0.8997326203208557,
        "threshold": 0.30513009655812007
      },
      {
        "fpr": 0.38229166666666664,
        "tpr": 0.9007352941176471,
        "threshold": 0.3035740716050249
      },
      {
        "fpr": 0.38645833333333335,
        "tpr": 0.9034090909090909,
        "threshold": 0.296952026221433
      },
      {
        "fpr": 0.39375,
        "tpr": 0.9060828877005348,
        "threshold": 0.2907355484614506
      },
      {
        "fpr": 0.4,
        "tpr": 0.9080882352941176,
        "threshold": 0.2859316680508011
      },
      {
        "fpr": 0.40520833333333334,
        "tpr": 0.9090909090909091,
        "threshold": 0.2842930877909053
      },
      {
        "fpr": 0.41041666666666665,
        "tpr": 0.9114304812834224,
        "threshold": 0.28081389128120116
      },
      {
        "fpr": 0.41354166666666664,
        "tpr": 0.9127673796791443,
        "threshold": 0.2783436540635306
      },
      {
        "fpr": 0.4197916666666667,
        "tpr": 0.9167780748663101,
        "threshold": 0.2720185994149681
      },
      {
        "fpr": 0.4270833333333333,
        "tpr": 0.919451871657754,
        "threshold": 0.26835337541848703
      },
      {
        "fpr": 0.4375,
        "tpr": 0.9207887700534759,
        "threshold": 0.2645799991481425
      },
      {
        "fpr": 0.44375,
        "tpr": 0.9241310160427807,
        "threshold": 0.25816565668012
      },
      {
        "fpr": 0.4510416666666667,
        "tpr": 0.9264705882352942,
        "threshold": 0.25441547126807423
      },
      {
        "fpr": 0.45416666666666666,
        "tpr": 0.9278074866310161,
        "threshold": 0.25324611565863236
      },
      {
        "fpr": 0.4583333333333333,
        "tpr": 0.929144385026738,
        "threshold": 0.25211077703845297
      },
      {
        "fpr": 0.46145833333333336,
        "tpr": 0.93048128342246,
        "threshold": 0.25044561378478425
      },
      {
        "fpr": 0.47291666666666665,
        "tpr": 0.9328208556149733,
        "threshold": 0.24516677836667983
      },
      {
        "fpr": 0.478125,
        "tpr": 0.9341577540106952,
        "threshold": 0.24323475461648278
      },
      {
        "fpr": 0.4895833333333333,
        "tpr": 0.9351604278074866,
        "threshold": 0.24053166770120427
      },
      {
        "fpr": 0.49270833333333336,
        "tpr": 0.9364973262032086,
        "threshold": 0.2385276065627994
      },
      {
        "fpr": 0.496875,
        "tpr": 0.9381684491978609,
        "threshold": 0.23639032040456534
      },
      {
        "fpr": 0.5020833333333333,
        "tpr": 0.9411764705882353,
        "threshold": 0.23263949094717212
      },
      {
        "fpr": 0.5145833333333333,
        "tpr": 0.9428475935828877,
        "threshold": 0.2274639212576347
      },
      {
        "fpr": 0.5239583333333333,
        "tpr": 0.946524064171123,
        "threshold": 0.22331799930433746
      },
      {
        "fpr": 0.5291666666666667,
        "tpr": 0.9488636363636364,
        "threshold": 0.22071137708175986
      },
      {
        "fpr": 0.5416666666666666,
        "tpr": 0.9498663101604278,
        "threshold": 0.2155498748334797
      },
      {
        "fpr": 0.55625,
        "tpr": 0.9518716577540107,
        "threshold": 0.21067217049428952
      },
      {
        "fpr": 0.5697916666666667,
        "tpr": 0.9538770053475936,
        "threshold": 0.2075907517951023
      },
      {
        "fpr": 0.5770833333333333,
        "tpr": 0.954879679144385,
        "threshold": 0.20645454754271939
      },
      {
        "fpr": 0.5822916666666667,
        "tpr": 0.9558823529411765,
        "threshold": 0.20481038473613675
      },
      {
        "fpr": 0.5885416666666666,
        "tpr": 0.9578877005347594,
        "threshold": 0.20221451190654305
      },
      {
        "fpr": 0.59375,
        "tpr": 0.9595588235294118,
        "threshold": 0.20100962412800139
      },
      {
        "fpr": 0.5989583333333334,
        "tpr": 0.9605614973262032,
        "threshold": 0.19916948519743657
      },
      {
        "fpr": 0.6125,
        "tpr": 0.9615641711229946,
        "threshold": 0.19519659070776713
      },
      {
        "fpr": 0.61875,
        "tpr": 0.9629010695187166,
        "threshold": 0.1932325307353322
      },
      {
        "fpr": 0.6395833333333333,
        "tpr": 0.963903743315508,
        "threshold": 0.1891219723510702
      },
      {
        "fpr": 0.65,
        "tpr": 0.9649064171122995,
        "threshold": 0.1867984842647356
      },
      {
        "fpr": 0.671875,
        "tpr": 0.9662433155080213,
        "threshold": 0.17980725623132604
      },
      {
        "fpr": 0.6927083333333334,
        "tpr": 0.9675802139037433,
        "threshold": 0.17471738985635146
      },
      {
        "fpr": 0.7052083333333333,
        "tpr": 0.9689171122994652,
        "threshold": 0.17109746989001984
      },
      {
        "fpr": 0.7114583333333333,
        "tpr": 0.9702540106951871,
        "threshold": 0.16848623003218027
      },
      {
        "fpr": 0.7197916666666667,
        "tpr": 0.9712566844919787,
        "threshold": 0.16618739502178195
      },
      {
        "fpr": 0.7291666666666666,
        "tpr": 0.9722593582887701,
        "threshold": 0.16443849365485194
      },
      {
        "fpr": 0.7416666666666667,
        "tpr": 0.973596256684492,
        "threshold": 0.15993254051012717
      },
      {
        "fpr": 0.7458333333333333,
        "tpr": 0.9749331550802139,
        "threshold": 0.1575599308199894
      },
      {
        "fpr": 0.75,
        "tpr": 0.9759358288770054,
        "threshold": 0.15673724526676516
      },
      {
        "fpr": 0.7625,
        "tpr": 0.9769385026737968,
        "threshold": 0.15186127876822625
      },
      {
        "fpr": 0.7708333333333334,
        "tpr": 0.9782754010695187,
        "threshold": 0.14729515129142934
      },
      {
        "fpr": 0.778125,
        "tpr": 0.9796122994652406,
        "threshold": 0.14511758392865245
      },
      {
        "fpr": 0.7885416666666667,
        "tpr": 0.9809491978609626,
        "threshold": 0.1419501076593161
      },
      {
        "fpr": 0.7947916666666667,
        "tpr": 0.982620320855615,
        "threshold": 0.13929182471618531
      },
      {
        "fpr": 0.8020833333333334,
        "tpr": 0.9852941176470589,
        "threshold": 0.13481114528385288
      },
      {
        "fpr": 0.8177083333333334,
        "tpr": 0.9876336898395722,
        "threshold": 0.1281587095780218
      },
      {
        "fpr": 0.828125,
        "tpr": 0.9886363636363636,
        "threshold": 0.12549075456500147
      },
      {
        "fpr": 0.840625,
        "tpr": 0.990975935828877,
        "threshold": 0.1222422094558844
      },
      {
        "fpr": 0.8479166666666667,
        "tpr": 0.9923128342245989,
        "threshold": 0.11856908691578584
      },
      {
        "fpr": 0.8552083333333333,
        "tpr": 0.9936497326203209,
        "threshold": 0.11676585112647941
      },
      {
        "fpr": 0.8604166666666667,
        "tpr": 0.9946524064171123,
        "threshold": 0.11494528680548356
      },
      {
        "fpr": 0.871875,
        "tpr": 0.9966577540106952,
        "threshold": 0.10726037566725748
      },
      {
        "fpr": 0.8770833333333333,
        "tpr": 0.9976604278074866,
        "threshold": 0.10584720275945095
      },
      {
        "fpr": 0.8875,
        "tpr": 0.9986631016042781,
        "threshold": 0.10181038962460029
      },
      {
        "fpr": 1.0,
        "tpr": 1.0,
        "threshold": 0.0
      }
    ],
    "threshold_055": {
      "threshold": 0.55,
      "tp": 1853,
      "fp": 120,
      "tn": 840,
      "fn": 1139,
      "tpr": 0.6193181818181818,
      "fpr": 0.125
    },
    "parameters": {
      "n_estimators": 200,
      "contamination": 0.02,
      "random_state": 20260812,
      "n_jobs": -1
    }
  },
  "limitations": [
    "Training and test data both come from the same physics simulator, and the features are generated by the same equations. The classifier learns the simulator output distribution, not pump physics. These scores are capability ceilings, not field-performance predictions.",
    "Empirically, when the duty point changed from 20 L/min to 110 L/min, the original model predicted every frame in the new distribution as anomalous until retrained. A model that learned pump physics would not collapse that way under a pure operating-point shift.",
    "normal and sensor_fault overlap in feature space; the committed misdiagnosis rate remains 45%. Healthy operation can still be reported as sensor_fault.",
    "Fault Diagnosis currently uses browser-side physics rather than the backend classifier for the visible fallback because the classifier has this boundary.",
    "The physics_model_conflict flag exists to expose disagreement between physics evidence and model evidence instead of hiding it."
  ],
  "source_hashes": {
    "classifier_sha256": "8b2f230350a7cc338135e024ed8c7bad8576c453c3eba91c84b3e126c35af01e",
    "anomaly_sha256": "931c5b3384c18c524ef82acccf4eb5106a55fda1134e52dec2eae5e5b37b4a1c",
    "dataset_sha256": "62a712d47a129a9efecbca31caaafa6cdd8b2b49b799400d1ae4ad52b40fbf45",
    "dataset_meta_sha256": "87faf5fa5485b3f548ff31a8a4279c4998a2bc873a108727dc303f4ca3564e6a"
  }
} as const
